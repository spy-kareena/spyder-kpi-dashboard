// 2v9 (owner) Settings: two panes, a section list that stays in view (aria-current on the section on screen) and one
// column of sections, each a small heading over one panel of plain rows (label + short hint, control at the right);
// stgShowCard opens Settings at a section. Run with `node tests/settings-categories.test.js`. Fixtures are synthetic.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const html = (page) => page.els['results-screen'].innerHTML;
// The sections in page order (the ids after stg-sec-), and each section's markup.
const secs = (h) => [...h.matchAll(/<section class="stg-sec" id="stg-sec-(\w+)"/g)].map((c) => c[1]);
const sec = (h, id) => { const at = h.indexOf(`<section class="stg-sec" id="stg-sec-${id}"`); return at < 0 ? '' : h.slice(at, h.indexOf('</section>', at)); };
const words = (x) => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const ORDER = ['general', 'data', 'sales', 'po', 'display', 'pages', 'notes', 'ai', 'about'];

async function loaded(rows) {
  const page = loadPage({ storage: { ...IMPORT } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}

test('Settings is two panes: the section list (one button a section, aria-current on General) and the nine sections in order; no card grid', async () => {
  const page = await loaded([sapRow({ DocumentNumber: '777', DueDate: '07/16/0202', LineDueDate: '07/16/0202', HeaderDueDate: '07/16/0202' })]);
  page.run("setTab('settings')");
  const h = html(page);
  assert.match(h, /<div class="stg-layout"><nav class="stg-nav print-hide" aria-label="Settings sections"><ul class="stg-nav-list">/);
  const nav = [...h.matchAll(/<button type="button" class="stg-nav-i" data-stg-nav="(\w+)" data-focus-key="stg-nav-\1" aria-controls="stg-sec-\1"( aria-current="true")? onclick="stgNavGo\('\1'\)"[^>]*>([^<]+)/g)].map((m) => [m[1], !!m[2], m[3]]);
  assert.deepEqual(nav.map((n) => n[0]), ORDER);
  assert.deepEqual(nav.map((n) => n[2]), ['General', 'Data', 'Sales Orders', 'Purchase Orders', 'Display', 'Pages', 'Notes', 'AI', 'About']);
  assert.deepEqual(nav.filter((n) => n[1]).map((n) => n[0]), ['general']);
  assert.deepEqual(secs(h), ORDER);
  assert.doesNotMatch(h, /stg-bento|stg-card|dz-card/);
  // Each section: a small heading (the tip carries the detail) over one panel.
  for (const id of ORDER) assert.match(sec(h, id), new RegExp(`<h2 class="stg-sec-h" id="stg-h-${id}" tabindex="-1"[^>]*>[^<]+</h2>[\\s\\S]*?<div class="stg-panel">`), id);
  // The gear's red Data check dot: on Data in the list (said in words too) and on the Data Check heading in Data.
  assert.equal(page.run('stgDataCheckLevel()'), 'red');
  assert.match(h, /data-stg-nav="data"[^>]*>Data<span class="stg-nav-dot red" aria-hidden="true"><\/span><span class="sr-only">, data check needs attention<\/span>/);
  assert.match(sec(h, 'data'), /<div class="stg-block stg-dc-block" id="stg-dc">[\s\S]*?<span class="stg-dc-dot red" aria-hidden="true"><\/span>Data Check<\/h3>/);
  // Reset to defaults sits in About, once, after Export / Import.
  assert.equal(h.split('data-focus-key="stg-reset-all"').length - 1, 1);
  assert.match(sec(h, 'about'), /data-focus-key="stg-export"[\s\S]*data-focus-key="stg-import"[\s\S]*data-focus-key="stg-reset-all"/);
  // The bento's code is gone.
  assert.equal(page.run('typeof stgBentoFit'), 'undefined');
  assert.equal(page.run('typeof stgCard'), 'undefined');
  assert.deepEqual(page.errors, []);
});

test('the section list marks the section on screen: stgNavGo, stgNavMark and the scroll spy (stgNavSpy) move aria-current', async () => {
  const page = await loaded([sapRow()]);
  page.run("setTab('settings')");
  // A small DOM over the drawn page: nav buttons and sections with tops the test sets.
  page.run(`(()=>{
    const navs=${JSON.stringify(ORDER)}.map(k=>({dataset:{stgNav:k},attrs:{},setAttribute(n,v){this.attrs[n]=v;},removeAttribute(n){delete this.attrs[n];}}));
    const tops={};${JSON.stringify(ORDER)}.forEach((k,i)=>tops[k]=200+i*600);
    const sections=${JSON.stringify(ORDER)}.map(k=>({dataset:{stgSec:k},getBoundingClientRect:()=>({top:tops[k]-(window.scrollY||0)}),scrollIntoView(o){globalThis.__scrolled=[k,o.block];}}));
    const heads={};${JSON.stringify(ORDER)}.forEach(k=>heads['stg-h-'+k]={focus(o){globalThis.__focused=['stg-h-'+k,o&&o.preventScroll];}});
    globalThis.__navs=navs;
    const byId=document.getElementById;
    document.getElementById=id=>id.startsWith('stg-sec-')?sections.find(s=>'stg-sec-'+s.dataset.stgSec===id):heads[id]||byId(id);
    document.querySelectorAll=s=>s==='.stg-nav-i'?navs:s==='.stg-sec'?sections:[];
    document.querySelector=s=>s==='.stg-nav-i[aria-current]'?navs.find(n=>n.attrs['aria-current'])||null:null;
    document.documentElement.scrollHeight=6000;window.innerHeight=900;window.scrollY=0;
  })()`);
  const current = () => page.run("__navs.filter(n=>n.attrs['aria-current']==='true').map(n=>n.dataset.stgNav)");
  page.run('stgNavSpy()');
  assert.deepEqual(current(), ['general']);
  // A click: marked at once, its heading focused without a jump, the section scrolled to the top.
  page.run("stgNavGo('po')");
  assert.deepEqual(current(), ['po']);
  assert.deepEqual(page.run('__scrolled'), ['po', 'start']);
  assert.deepEqual(page.run('__focused'), ['stg-h-po', true]);
  assert.equal(page.run('stgNavCur'), 'po');
  // While the click's scroll runs the spy leaves it; after it, scrolling marks the section whose top passed the line.
  page.run('window.scrollY=2500;stgNavSpy()');
  assert.deepEqual(current(), ['po']);
  page.run('stgNavHoldUntil=0;stgNavSpy()');
  assert.deepEqual(current(), ['display']);
  // At the page's end the last section is marked.
  page.run('window.scrollY=6000-900;stgNavSpy()');
  assert.deepEqual(current(), ['about']);
  // A redraw keeps the mark; leaving Settings and coming back starts at General.
  page.run('renderResults()');
  assert.match(html(page), /data-stg-nav="about"[^>]*aria-current="true"/);
  page.run("setTab('weekly');setTab('settings')");
  assert.match(html(page), /data-stg-nav="general"[^>]*aria-current="true"/);
  assert.deepEqual(page.errors, []);
});

test('rows: label and a short grey hint at the left, the control at the right; every control is still there', async () => {
  const page = await loaded([sapRow()]);
  page.run("setTab('settings')");
  const h = html(page);
  assert.doesNotMatch(words(h), /Saved in this browser|everyone who signs in|Read only/);
  // Hints stay short: twelve words or fewer, no "Default …" restating.
  for (const m of h.matchAll(/<span class="stg-help">([^<]*)<\/span>/g)) assert.ok(m[1].split(' ').length <= 12 && !/Default/.test(m[1]), m[1]);
  assert.match(h, /<div class="stg-row"><div class="stg-l"><label class="stg-label" for="stg-target">At-risk target<\/label><span class="stg-help">Amber up to twice it, red above\.<\/span><\/div><div class="stg-ctl">/);
  assert.match(h, /id="stg-h-sales" tabindex="-1" data-tip="Sales Orders\n• At-risk target: share of open value at risk\n• Tolerance: days late still on track\n• Look-ahead: lines due within it count\n• Defaults: 5%, 2 days, 1 month, 10, Leading, 90%">/);
  assert.match(h, /id="stg-h-data" tabindex="-1" data-tip="Data\n• Live SAP: read every 5 minutes/);
  assert.match(sec(h, 'data'), /<span class="stg-label">Data source<\/span>[\s\S]*?aria-label="Data source"/);
  // The sections hold what the proposal says.
  const has = (id, keys) => { for (const k of keys) assert.match(sec(h, id), new RegExp(`data-focus-key="${k}"`), `${id}: ${k}`); };
  has('general', ['stg-name', 'stg-startPage']);
  has('data', ['stg-ds-live', 'stg-ds-import', 'stg-ds-upload', 'stg-ds-add', 'stg-ds-new', 'stg-importReport-always']);
  has('sales', ['stg-target', 'stg-tolerance', 'stg-horizon', 'stg-linesShown-10', 'stg-openingView-leading', 'stg-otdGoalSales']);
  has('po', ['stg-otdGoalVendors', 'stg-poOpeningView-open', 'stg-poOpeningView-received']);
  has('display', ['stg-theme-dark', 'stg-bg-blue', 'stg-christmas-on', 'stg-linesStart-open']);
  has('pages', ['stg-page-warehouses']);
  has('notes', ['stg-notes-po', 'stg-add-so']);
  has('ai', ['stg-connect-setup']);
  has('about', ['stg-export', 'stg-import', 'stg-reset-all']);
  assert.match(sec(h, 'display'), /role="radiogroup" aria-label="Background"/);
  // Wide lists are full-width blocks in their panel.
  assert.match(sec(h, 'notes'), /<div class="stg-block stg-notes-block"><ul class="stg-list"/);
  assert.match(sec(h, 'pages'), /<div class="stg-block stg-hp-block"><div class="stg-hp-list">/);
  assert.match(sec(h, 'data'), /<div class="stg-block stg-data-block" id="stg-data"><dl class="stg-dl">[\s\S]*?<dt>Files<\/dt>/);
  assert.deepEqual(page.errors, []);
});

test('stgShowCard opens Settings at the section: Connect with its setup open, your name, Data Check', async () => {
  const page = await loaded([sapRow()]);
  page.run("setTab('weekly')");
  page.run("setTab('connect')");
  assert.equal(page.run('activeTab'), 'settings');
  assert.match(html(page), /id="stg-sec-ai"[\s\S]*?<details class="stg-setup" open/);
  assert.equal(page.run('stgNavCur'), 'ai');
  page.run("setTab('weekly')");
  page.run("stgShowCard('profile','stg-name')");
  assert.equal(page.run('activeTab'), 'settings');
  assert.match(html(page), /id="stg-sec-general"[\s\S]*?id="stg-name"/);
  page.run("stgShowCard('dc')");
  assert.equal(page.run('stgNavCur'), 'data');
  page.run('renderResults()');
  assert.deepEqual(page.errors, []);
});

test('the layout CSS: its own block, two panes with a sticky list, one column up to 820px, a chip row on phones, no sticky list in print, tokens only', () => {
  const start = HTML.indexOf('/* 2v9 (owner): Settings layout */'), end = HTML.indexOf('/* 2v9 (owner): end Settings layout */');
  assert.ok(start > 0 && end > start);
  const css = HTML.slice(start, end);
  assert.match(css, /\.stg-layout\{display:grid;grid-template-columns:200px minmax\(0,820px\);/);
  assert.match(css, /\.stg-nav\{position:sticky;top:16px;/);
  assert.match(css, /\.stg-nav-i\[aria-current="true"\]\{background:var\(--dz-indigo-bg\);color:var\(--dz-indigo-deep\);/);
  assert.match(css, /\.stg-panel\{background:var\(--dz-surface\);border:1px solid var\(--dz-line-8\);/);
  assert.match(css, /@media \(max-width:640px\)\{[\s\S]*?\.stg-layout\{grid-template-columns:minmax\(0,1fr\);[\s\S]*?\.stg-nav-list\{flex-direction:row;[^}]*overflow-x:auto/);
  assert.match(css, /@media print\{[\s\S]*?\.stg-nav\{display:none\}/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,6}\b|rgba?\(/i, 'no colours of its own');
  // The bento grid and its fitter are gone.
  assert.doesNotMatch(HTML, /2v9:settings-bento|\.stg-bento|function stgBentoFit/);
  assert.match(HTML, /dzFitTables\(el\);\n  stgNavWatch\(\);/);
});

test('a shared snapshot: settings read only, every section still there', async () => {
  const page = await loaded([sapRow()]);
  page.run("isSnapshotView=true;setTab('settings')");
  const h = html(page);
  assert.match(h, /<p class="stg-ro rise">Shared snapshot: settings are read only\./);
  assert.deepEqual(secs(h), ORDER);
  assert.match(h, /data-focus-key="stg-reset-all" onclick="stgResetAll\(\)" disabled/);
  assert.doesNotMatch(h, /data-focus-key="stg-export"/);
  assert.match(h, /id="stg-target"[^>]*disabled/);
  assert.match(h, /id="stg-otdGoalSales"[^>]*disabled/);
});

// 2v6.9: Hidden Pages. A page in the hiddenPages setting leaves the top menu and the Supply menu; setTab to it, a
// snapshot or search that would open it go to Order Health. Warehouses is hidden by default; Order Health cannot be.
const header = (page) => page.els['app-header'].innerHTML;
const card = (h) => sec(h, 'pages');
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
  assert.match(c, /<h2 class="stg-sec-h" id="stg-h-pages" tabindex="-1" data-tip="Hidden Pages\n• A hidden page leaves the top menu and the Supply menu\n• Turn one on to bring it back">Pages<\/h2>/);
  assert.match(c, /<span class="stg-help">Hidden pages leave the top menu\. Turn one on to show it\.<\/span>/);
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
