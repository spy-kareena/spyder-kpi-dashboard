// 2v9 Settings: one bento grid of compact tiles (no category bar or headings, no where-it-is-kept lines, short help);
// stgShowCard opens Settings at a card. Run with `node tests/settings-categories.test.js`. Fixtures are synthetic.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const html = (page) => page.els['results-screen'].innerHTML;
// The tiles in page order (the ids after stg-card-), all inside the one bento grid.
const tiles = (h) => [...h.matchAll(/<section class="dz-card stg-card[^"]*" id="stg-card-(\w+)"/g)].map((c) => c[1]);
const cards = (h) => h.split(/(?=<section class="dz-card stg-card)/).slice(1);
const words = (x) => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function loaded(rows) {
  const page = loadPage({ storage: { ...IMPORT } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}

test('Settings is one bento grid: every tile in reading order, no category bar or headings, Data Check first', async () => {
  const page = await loaded([sapRow({ DocumentNumber: '777', DueDate: '07/16/0202', LineDueDate: '07/16/0202', HeaderDueDate: '07/16/0202' })]);
  page.run("setTab('settings')");
  const h = html(page);
  assert.match(h, /<div class="stg-bento"><section class="dz-card stg-card dz-fade" id="stg-card-dc"/);
  assert.deepEqual(tiles(h), ['dc', 'source', 'data', 'oh', 'pages', 'hiddenpages', 'profile', 'notes', 'ai', 'connect', 'about']);
  assert.doesNotMatch(h, /stg-nav|stg-cat|stg-cgrid|pg-group|Settings categories|stg-end/);
  // The gear's red Data check dot is on the Data Check tile's icon.
  assert.equal(page.run('stgDataCheckLevel()'), 'red');
  assert.match(cards(h)[0], /<span class="dz-ico stg-ico-dot"[^>]*>[\s\S]*?<span class="hdr-dot red"><\/span><\/span>Data Check<\/h2>/);
  // Reset to defaults sits in About, once; the old two columns and the foot link are gone.
  assert.equal(h.split('data-focus-key="stg-reset-all"').length - 1, 1);
  assert.match(h, /id="stg-card-about"[\s\S]*data-focus-key="stg-reset-all"/);
  assert.doesNotMatch(h, /stg-col|stg-grid|stg-top|stg-foot/);
  // The bar's code is gone too (renderResults no longer calls it).
  for (const fn of ['stgNavWatch', 'stgNavGo', 'stgNavSet', 'stgCatOf', 'stgNavHtml']) assert.equal(page.run(`typeof ${fn}`), 'undefined', fn);
  assert.deepEqual(page.errors, []);
});

test('no where-it-is-kept lines, and help cut to one short line where a control needs it; the rest is in title tips', async () => {
  const page = await loaded([sapRow()]);
  page.run("setTab('settings')");
  const h = html(page);
  assert.doesNotMatch(words(h), /Saved in this browser|this browser|everyone who signs in|Export and Import move them|Read only/);
  assert.doesNotMatch(h, /class="page-meta"[^>]*>Saved/);
  // At most one help line a tile, ten words or fewer; no "Default …" restating.
  for (const c of cards(h)) {
    const helps = [...c.matchAll(/<span class="stg-help">([^<]*)<\/span>/g)].map((m) => m[1]);
    assert.ok(helps.length <= 1, `${c.slice(0, 80)}: ${helps}`);
    for (const t of helps) assert.ok(t.split(' ').length <= 10 && !/Default/.test(t), t);
  }
  assert.match(h, /<label class="stg-label" for="stg-target">At-risk target<\/label><span class="stg-help">Amber up to twice it, red above\.<\/span>/);
  // What left the tiles is in their title tips ("Line\n• fact").
  assert.match(h, /id="stg-h-oh" tabindex="-1" data-tip="Sales Order Health\n• At-risk target: share of open value at risk\n• Tolerance: days late still on track\n• Look-ahead: lines due within it count\n• Defaults: 5%, 2 days, 1 month, 10, Leading">/);
  assert.match(h, /id="stg-h-source" tabindex="-1" data-tip="Data Source\n• Live SAP: read every 5 minutes/);
  // Data Source: the switch alone (the tile title names it), still named for screen readers.
  assert.match(h, /<div class="stg-solo"><[^>]*aria-label="Data source"/);
  // Import mode: the Data tile leaves Add / New to the Data Source tile (no duplicate buttons).
  assert.doesNotMatch(h, /data-focus-key="stg-add-files"|data-focus-key="stg-new-export"/);
  assert.match(h, /data-focus-key="stg-ds-upload"[\s\S]*data-focus-key="stg-ds-add"[\s\S]*data-focus-key="stg-ds-new"/);
  // Every control is still there.
  for (const k of ['stg-target', 'stg-tolerance', 'stg-horizon', 'stg-linesShown-10', 'stg-openingView-leading', 'stg-theme-dark', 'stg-linesStart-open', 'stg-importReport-always', 'stg-page-warehouses', 'stg-name', 'stg-notes-po', 'stg-export', 'stg-import', 'stg-reset-all', 'stg-connect-setup']) assert.match(h, new RegExp(`data-focus-key="${k}"`), k);
  assert.match(h, /role="radiogroup" aria-label="Background"/);
  assert.deepEqual(page.errors, []);
});

test('stgShowCard opens Settings at the card: Connect with its setup open, your name, Data Check', async () => {
  const page = await loaded([sapRow()]);
  page.run("setTab('weekly')");
  page.run("setTab('connect')");
  assert.equal(page.run('activeTab'), 'settings');
  assert.match(html(page), /id="stg-card-connect"[\s\S]*?<details class="stg-setup" open/);
  page.run("setTab('weekly')");
  page.run("stgShowCard('profile','stg-name')");
  assert.equal(page.run('activeTab'), 'settings');
  assert.match(html(page), /id="stg-card-profile"[\s\S]*?id="stg-name"/);
  page.run("stgShowCard('dc')");
  page.run('renderResults()');
  assert.deepEqual(page.errors, []);
});

test('the bento keeps the design language: dense grid, 4 / 3 / 2 / 1 columns, spans, fit rows, off paper', () => {
  const css = HTML.slice(HTML.indexOf('/* 2v9:settings-bento */'), HTML.indexOf('/* 2v9:end settings-bento */'));
  assert.ok(css.length > 0 && HTML.indexOf('/* 2v9:end settings-bento */') < HTML.indexOf('/* 2v9:pager */'));
  assert.match(css, /\.stg-bento\{[^}]*display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);grid-auto-flow:row dense;/);
  assert.match(css, /\.stg-bento>:is\(#stg-card-dc,#stg-card-data,#stg-card-oh,#stg-card-pages,#stg-card-hiddenpages,#stg-card-notes,#stg-card-about\)\{grid-column:span 2\}/);
  assert.match(css, /@media \(max-width:1279px\)\{\s*\.stg-bento\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
  assert.match(css, /@media \(max-width:979px\)\{\.stg-bento\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
  assert.match(css, /@media \(max-width:639px\)\{\s*\.stg-bento\{--stg-gap:12px;grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.stg-bento\.fit\{grid-auto-rows:2px;row-gap:0;/);
  assert.match(css, /container-type:inline-size/);
  assert.match(css, /@media print\{[\s\S]*grid-row-end:auto!important/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b|rgba?\(/i, 'no colours of its own');
  // The old bar and category grid are gone from the 2v8 block.
  const old = HTML.slice(HTML.indexOf('/* 2v8:settings */'), HTML.indexOf('/* 2v8:end settings */'));
  assert.doesNotMatch(old, /stg-nav|stg-cgrid|stg-cat/);
  // stgBentoFit: each tile spans the 2px rows it needs, measured by a ResizeObserver; called after every redraw.
  assert.match(HTML, /function stgBentoFit\(\)\{[\s\S]*?typeof ResizeObserver==='function'[\s\S]*?gridRowEnd=`span \$\{/);
  assert.match(HTML, /dzFitTables\(el\);\n  stgBentoFit\(\);/);
});

test('a shared snapshot: settings read only, the bento still there', async () => {
  const page = await loaded([sapRow()]);
  page.run("isSnapshotView=true;setTab('settings')");
  const h = html(page);
  assert.match(h, /<p class="stg-ro rise">Shared snapshot: settings are read only\./);
  assert.equal(tiles(h).length, 10);
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
  // The card: the help in its title tip, Warehouses first and off, Order Health and Settings not offered.
  page.run("setTab('settings')");
  const c = card(html(page));
  assert.match(c, /<h2 class="dz-title sm stg-title" id="stg-h-hiddenpages" tabindex="-1" data-tip="Hidden Pages\n• A hidden page leaves the top menu and the Supply menu\n• Turn one on to bring it back">[\s\S]*Hidden Pages<\/h2>/);
  assert.doesNotMatch(c, /stg-help|stg-now/);
  const rows = [...c.matchAll(/<button type="button" role="switch" class="stg-switch" id="stg-page-(\w+)" data-focus-key="stg-page-\1" aria-checked="(true|false)" aria-label="Show ([^"]+)" onclick="stgTogglePage\(&#39;\1&#39;\)"/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows[0], ['warehouses', 'false', 'Warehouses']);
  assert.ok(rows.length >= 7 && rows.slice(1).every((r) => r[1] === 'true'), JSON.stringify(rows));
  assert.ok(!rows.some((r) => r[0] === 'weekly' || r[0] === 'settings' || r[0] === 'metrics'));
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
