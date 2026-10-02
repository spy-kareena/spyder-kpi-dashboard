// Review fixes: page layout, CSS contrast, print output and accessibility. Run with `node tests/review-pages-css-print-a11y.test.js`.
// Fixtures are synthetic (harness.js); no SAP data.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const CSS = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const html = (page) => page.els['results-screen'].innerHTML;
async function loaded(rows = [sapRow({})]) {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}

test('ship target dates: keyboard edits wait for Enter or blur, calendar picks apply at once', async () => {
  const page = await loaded();
  page.run('setTab("monthly");window.__renders=0;renderResults=(f=>function(){window.__renders++;return f.apply(this,arguments);})(renderResults)');
  const markup = html(page);
  assert.match(markup, /id="ship-scenario-start"[^>]*onchange="setShipScenarioStartDate\(this\.value,!!this\.dataset\.typed\)"[^>]*onkeydown="[^"]*commitShipScenarioDates\(\)[^"]*"[^>]*onblur="setTimeout\(commitShipScenarioDates\)"/);
  assert.match(markup, /id="ship-scenario-end"[^>]*onchange="setShipScenarioTargetDate\(this\.value,!!this\.dataset\.typed\)"/);
  page.run("setShipScenarioStartDate('2026-09-10',true);setShipScenarioTargetDate('2026-10-15',true)");
  assert.deepEqual(page.run('[window.__renders,shipScenarioStartDate,shipScenarioTargetDate]'), [0, '2026-09-10', '2026-10-15']);
  page.run('commitShipScenarioDates();commitShipScenarioDates()');
  assert.equal(page.run('window.__renders'), 1, 'one redraw for the pending edits, none when nothing is pending');
  page.run("setShipScenarioStartDate('2026-09-11')");
  assert.equal(page.run('window.__renders'), 2);
});

test('mini-strip tiles draw their focus ring inside the clipped strip', () => {
  assert.match(CSS, /\.mini-strip\{[^}]*overflow:hidden/);
  assert.match(CSS, /\.mini-strip>button:focus-visible\{outline:2px solid var\(--accent\);outline-offset:-2px\}/);
});

const PO = (o) => sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', ...o });
const MIX = [
  sapRow({ DocumentNumber: '501', Warehouse: 'Spyder - Lacombe' }),
  sapRow({ DocumentNumber: '502', Warehouse: 'CM - Alta', DueDate: '10/15/2026', LineDueDate: '10/15/2026' }),
  PO({ DocumentNumber: '700', Warehouse: 'CM - Alta', DueDate: '08/10/2026', LineDueDate: '08/10/2026' }),
];

test('scorecard and PO warehouse rows name each value by its column; header rows hidden from AT', async () => {
  const page = await loaded(MIX);
  page.run('setTab("weekly")');
  let m = html(page);
  assert.match(m, /<div class="thead sc-cols" aria-hidden="true">/);
  assert.match(m, /class="trow sc-cols[^"]*"[^>]*aria-label="Spyder - Lacombe: open \$[\d.]+K?, at risk [^,]+, past due [^,]+, OTD 3 mo no data, fill [^,]+, resched no data"/);
  page.run('setTab("purchaseorders")');
  m = html(page);
  assert.match(m, /<div class="thead po-wh-cols" aria-hidden="true">/);
  assert.match(m, /class="trow po-wh-cols[^"]*"[^>]*aria-label="CM - Alta: 1 lines, open value \$[\d.]+K?, late 1, no commit none, future none"/);
});

test('heat map is an ARIA table; cells are focusable with their breakdown as text; badge has no aria-label', async () => {
  const page = await loaded(MIX);
  page.run('setTab("warehouses")');
  const m = html(page);
  assert.match(m, /class="heat-scroll" role="table" aria-label="Open value by warehouse and due month"/);
  assert.match(m, /class="heat-grid head" role="row"[^>]*><div role="columnheader">Warehouse<\/div><div role="columnheader">/);
  assert.match(m, /class="heat-grid row" role="row"[^>]*><div class="heat-name" role="rowheader"/);
  const cells = m.match(/<div class="heat-slot"[^>]*>/g);
  assert.ok(cells.length >= 2);
  for (const c of cells) assert.match(c, /role="cell" tabindex="0" data-tip="[^"]+" onfocus="showHeatDetail\(this\.dataset\.tip\)"/);
  assert.match(m, /<span class="sr-only">, Spyder - Lacombe · [^<]*open · 1 rows[^<]*late[^<]*<\/span>/);
  assert.ok(!/late-badge" aria-label/.test(m), 'no aria-label on the generic badge span');
  assert.match(m, /<span class="late-badge" aria-hidden="true">1<\/span>/);
  assert.ok(!/heat-cell[^>]*title=/.test(m));
  assert.match(m, /<p class="heat-detail print-hide" id="wh-heat-detail" aria-hidden="true">/);
  page.run("showHeatDetail('A · Sep 2026: $1 open')");
  assert.equal(page.els['wh-heat-detail'].textContent, 'A · Sep 2026: $1 open');
  assert.match(CSS, /\.ai-sr,\.sr-only\{position:absolute/);
  assert.match(CSS, /\.heat-slot:focus-visible \.heat-cell\{outline:2px solid var\(--accent\)/);
});

// WCAG contrast from the :root tokens.
const TOKENS = Object.fromEntries([...CSS.match(/:root\{([\s\S]*?)\}/)[1].matchAll(/--([\w-]+):(#[0-9a-f]{3,6})/gi)].map((m) => [m[1], m[2]]));
const hex = (c) => (c.length === 4 ? c.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : c);
const lum = (c) => { const n = parseInt(hex(c).slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [lum(TOKENS[a] || a), lum(TOKENS[b] || b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('informational text no longer uses --gray-400; --gray-500 reads at 4.5:1 on page surfaces', () => {
  assert.ok(!/[{;]color:var\(--gray-400\)/.test(CSS), 'a text rule still uses --gray-400');
  for (const sel of ['.nav-label', '.muted', '.loaded-label', '.kpi-tag', '.bullet-scale', '.rank-no', '.table-tools .hint', '.ai-foot', '.heat-0', '.data-table .muted']) {
    assert.match(CSS, new RegExp(`(^|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*color:var\\(--gray-500\\)`, 'm'), sel);
  }
  assert.match(CSS, /\.lines-table \.c-item \.desc\{color:var\(--gray-500\)/);
  assert.match(CSS, /\.sidebar-search input::placeholder\{color:var\(--gray-500\)\}/);
  for (const bg of ['white', 'gray-50', 'accent-tint']) assert.ok(ratio('gray-500', bg) >= 4.5, bg);
});

test('small status text uses the darker tone tokens and passes 4.5:1', () => {
  const rule = (sel) => { const m = CSS.match(new RegExp(`(?:^|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`, 'm')); assert.ok(m, sel); return m[1]; };
  const colorOf = (sel) => (rule(sel).match(/(?:^|;)color:(?:var\(--([\w-]+)\)|(#[0-9a-f]+))/) || []).slice(1).find(Boolean);
  const cases = [
    ['.tone-cell.good', 'good-tint'], ['.tone-cell.warning', 'warn-tint'], ['.tone-cell.critical', 'crit-tint'],
    ['.crit-text', 'white'], ['.warn-text', 'white'], ['.good-text', 'white'], ['.warn-text', 'accent-tint'],
    ['.trow .warn-cell', 'white'], ['.data-table .warn-soft', 'white'], ['.count-badge.bad', 'crit-tint'],
    ['.heat-3', '#53b1fd'], ['.heat-4', 'accent'], ['.link-btn', 'gray-50'], ['.link-btn', 'warn-tint'], ['.ai-notice a', 'warn-tint'],
  ];
  for (const [sel, bg] of cases) {
    const fg = colorOf(sel);
    assert.ok(fg, `${sel} has a colour`);
    assert.ok(ratio(fg === '#fff' ? '#ffffff' : fg, bg) >= 4.5, `${sel} (${fg}) on ${bg}: ${ratio(fg === '#fff' ? '#ffffff' : fg, bg).toFixed(2)}`);
  }
  assert.ok(/\.nav-badge\{[^}]*background:var\(--crit-tint\);color:var\(--crit-text\)\}/.test(CSS));
  assert.ok(!/\.rank-row \.rv\.\w+-text\{/.test(CSS), 'rank values use the shared tone text classes');
});

test('Data check popover hangs from the title row (left edge of the page), not from the pill', () => {
  // Headless Chrome at 660/768/1024/1366px: popover 16-416 or 265-665 on every page, no horizontal scroll.
  assert.match(CSS, /\.page-head-main\{position:relative;/);
  assert.match(CSS, /\ndetails\.data-check\{(?![^}]*position)[^}]*\}/);
  assert.match(CSS, /\.data-check-pop\{position:absolute;top:100%;left:0;[^}]*width:400px;max-width:calc\(100vw - 32px\)/);
});

test('Data check popover closes on Esc (focus back on the pill) and when focus leaves it', async () => {
  const page = await loaded([sapRow({ DocumentNumber: '1', DueDate: '07/16/0202', LineDueDate: '07/16/0202' })]);
  page.run('setTab("weekly")');
  const tag = html(page).match(/<details class="data-check[^>]*>/)[0].replace(/&amp;/g, '&');
  const handler = (name) => tag.match(new RegExp(`${name}="([^"]*)"`))[1];
  const run = (code, el, event) => new Function('event', code).call(el, event);
  const summary = { focused: false, focus() { this.focused = true; } };
  const inside = {};
  const details = { open: true, querySelector: () => summary, contains: (n) => n === inside };
  run(handler('onfocusout'), details, { relatedTarget: inside });
  assert.equal(details.open, true, 'focus moving within the popover keeps it open');
  run(handler('onfocusout'), details, { relatedTarget: null });
  assert.equal(details.open, false, 'focus leaving closes it');
  details.open = true;
  run(handler('onkeydown'), details, { key: 'Tab' });
  assert.equal(details.open, true);
  run(handler('onkeydown'), details, { key: 'Escape' });
  assert.deepEqual([details.open, summary.focused], [false, true]);
  assert.match(html(page), /<div class="data-check-pop" tabindex="-1">/);
});

// Text of every @media print block (brace-matched).
const printCss = () => {
  const out = [];
  for (let i = CSS.indexOf('@media print{'); i >= 0; i = CSS.indexOf('@media print{', i + 1)) {
    let depth = 0, j = CSS.indexOf('{', i);
    for (let k = j; k < CSS.length; k++) { if (CSS[k] === '{') depth++; else if (CSS[k] === '}' && --depth === 0) { out.push(CSS.slice(j + 1, k)); break; } }
  }
  return out.join('\n');
};

test('print hides the Build Risk override / note controls; the print-only text copies remain', async () => {
  const page = await loaded();
  const table = page.run("renderRowsTable(parsedRows,{key:'t',title:'T',editable:true})");
  assert.match(table, /class="table editable-rows"/);
  assert.match(table, /class="row-override[^"]*"[\s\S]*?<span class="print-only">/);
  assert.match(table, /class="row-note[^"]*"[\s\S]*?<span class="print-only">/);
  assert.match(printCss(), /\.editable-rows \.row-override,\.editable-rows \.row-note\{display:none!important\}/);
});

test('empty text fields have a 3:1 border (search, Ask AI key and question, note editors)', () => {
  for (const sel of ['.note-editor textarea', '.sidebar-search input', '.ai-field input', '.ai-compose textarea']) {
    assert.match(CSS, new RegExp(`(^|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*border:1px solid var\\(--gray-500\\)`, 'm'), sel);
  }
  assert.match(CSS, /\.editable-rows \.row-note\{[^}]*border-color:var\(--gray-500\)\}/);
  for (const bg of ['white', 'gray-50']) assert.ok(ratio('gray-500', bg) >= 3, bg);
});

test('Fill rate and On-track rate show a neutral dash when no sales-order lines are loaded', async () => {
  const kpi = (m, label) => m.split(`>${label}</span>`)[1].match(/<span class="kpi-value ([\w ]+)"[^>]*>([^<]*)</).slice(1);
  const page = await loaded([PO({ DocumentNumber: '700' })]);
  page.run('setTab("weekly")');
  assert.deepEqual(kpi(html(page), 'Fill rate'), ['neutral', '—']);
  page.run('setTab("metrics")');
  assert.deepEqual(kpi(html(page), 'On-track rate'), ['neutral', '—']);
  // With lines loaded the cards still score them.
  const so = await loaded([sapRow({ DocumentNumber: '1' })]);
  so.run('setTab("weekly")');
  assert.deepEqual(kpi(html(so), 'Fill rate'), ['crit', '0%']);
  so.run('setTab("metrics")');
  assert.deepEqual(kpi(html(so), 'On-track rate'), ['crit', '0%']);
});

test('Export PDF prints every linked line past the on-screen caps (80 Order Health, 100 Purchase Orders)', async () => {
  const so = Array.from({ length: 90 }, (_, i) => sapRow({ DocumentNumber: String(1000 + i) }));
  const po = Array.from({ length: 105 }, (_, i) => PO({ DocumentNumber: String(5000 + i), DueDate: '08/10/2026', LineDueDate: '08/10/2026' }));
  const page = await loaded([...so, ...po]);
  const lines = () => html(page).split('class="line-row').length - 1;
  page.run('setTab("weekly");toggleWeeklyLinkedAll()');
  assert.equal(lines(), 80);
  page.run('refreshForPrint()');
  assert.equal(lines(), 90);
  assert.match(html(page), /Showing 90 of 90 rows/);
  page.run('endPrintMode();setTab("purchaseorders")');
  assert.equal(lines(), 20);
  page.run('refreshForPrint()');
  assert.equal(lines(), 105);
  page.run('endPrintMode()');
  assert.equal(lines(), 20);
});

run();
