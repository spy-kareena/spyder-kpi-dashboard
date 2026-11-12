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
    ['dash', 'Dashboard', ['oh', 'pages']],
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
  assert.deepEqual([...['source', 'dc', 'data', 'oh', 'pages', 'profile', 'notes', 'ai', 'connect', 'about']].map((c) => page.run(`stgCatOf('${c}')`)),
    ['data', 'data', 'data', 'dash', 'dash', 'notes', 'notes', 'ai', 'ai', 'about']);
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

run();
