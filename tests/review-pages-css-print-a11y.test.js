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
  // The row's name is its tip, amounts in full: screen readers hear it once (wireTip adds no description when the
  // aria-label equals the tip), never "$1.7K" and then "$1,722" again.
  assert.match(m, /class="trow sc-cols[^"]*"[^>]*aria-label="(Spyder - Lacombe: open \$[\d,]+, at risk \$[\d,]+, [\d,]+ past due, OTD no data, fill [^,]+, reschedule hit no data; click to filter\.)" data-tip="\1"/);
  page.run('setTab("purchaseorders")');
  m = html(page);
  assert.match(m, /<div class="thead po-wh-cols" aria-hidden="true">/);
  assert.match(m, /class="trow po-wh-cols[^"]*"[^>]*aria-label="(CM - Alta: \$1,000 open on 1 PO line, 1 late, 0 no commit, 0 future; click to filter\.)" data-tip="\1"/);
  assert.doesNotMatch(m, /class="trow (?:sc|po-wh)-cols[^"]*"[^>]*aria-label="[^"]*\$[\d.]+[KM]\b/, 'no short money in a row name');
});

test('heat map is an ARIA table; cells are focusable with their breakdown as text (and tip); badge has no aria-label; the legend names it', async () => {
  const page = await loaded(MIX);
  page.run('setTab("warehouses")');
  const m = html(page);
  assert.match(m, /class="heat-scroll" role="table" aria-label="Open value by warehouse and due month"/);
  assert.match(m, /class="heat-grid head" role="row"[^>]*><div role="columnheader">Warehouse<\/div><div role="columnheader">/);
  assert.match(m, /class="heat-grid row" role="row"[^>]*><div class="heat-name" role="rowheader"/);
  const cells = m.match(/<div class="heat-slot"[^>]*>/g);
  for (const c of cells) assert.match(c, /role="cell"( tabindex="0")? data-tip="[^"]+">/);
  // Cells with lines are Tab stops; empty cells ("nothing open") are not.
  assert.deepEqual(cells.map((c) => [/tabindex/.test(c), /nothing open/.test(c)]).filter(([t, empty]) => t === empty), []);
  assert.ok(cells.filter((c) => /tabindex/.test(c)).length >= 2);
  assert.match(m, /<span class="sr-only">, Spyder - Lacombe · [^<]*open · 1 line[^<]*late[^<]*<\/span>/);
  assert.ok(!/late-badge" aria-label/.test(m), 'no aria-label on the generic badge span');
  assert.match(m, /<span class="late-badge" aria-hidden="true">1<\/span>/);
  assert.ok(!/heat-cell[^>]*title=/.test(m));
  // The breakdown is each cell's tip (hover or focus): no "Hover a cell" line under the grid repeats it.
  assert.doesNotMatch(m, /wh-heat-detail|heat-detail|Hover a cell|showHeatDetail/);
  assert.doesNotMatch(HTML, /function showHeatDetail/);
  // The red badge is named in the card head; it sits inside the cell's corner, not over the cell edge.
  assert.match(m, /<span class="legend heat-key"><span><i class="heat-key-late" aria-hidden="true">●<\/i>late lines<\/span><\/span><\/div>/);
  assert.match(CSS, /\.heat-cell \.late-badge\{top:3px;right:3px;/);
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

// 2v7: the Data check pill and its popover left the page heads; the Settings Data Check card holds the list and the
// header gear's dot (red / yellow) says there is something to look at.
test('Data check lives in Settings: no pill in any page head; the gear dot and its label; the Settings card carries the dot', async () => {
  const page = await loaded([sapRow({ DocumentNumber: '1', DueDate: '07/16/0202', LineDueDate: '07/16/0202' })]);
  for (const t of ['weekly', 'monthly', 'warehouses', 'metrics', 'shipping', 'purchaseorders']) {
    page.run(`setTab(${JSON.stringify(t)})`);
    assert.doesNotMatch(html(page), /class="data-check|data-focus-key="data-check"/, t);
  }
  const gear = page.els['app-header'].innerHTML.match(/<button[^>]*id="hdr-gear"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(gear, /aria-label="Settings, data check: 1 row or file needs attention"/);
  assert.match(gear, /onclick="dzMenuClose\(\);setTab\('settings'\)"/);
  assert.match(gear, /<span class="hdr-dot red" aria-hidden="true"><\/span>/);
  page.run('setTab("settings")');
  assert.match(html(page), /<h2 class="dz-title sm stg-title" id="stg-h-dc" tabindex="-1"><span class="dz-ico stg-ico-dot"[^>]*>[\s\S]*?<span class="hdr-dot red"><\/span><\/span>Data Check<\/h2>/);
  assert.match(page.els['app-header'].innerHTML, /id="hdr-gear"[^>]*aria-current="page"/);
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

test('print: Build Risk rows print the override, cause and note as text; the Edit button and the editor stay off paper', async () => {
  const page = await loaded();
  const row = page.run("(()=>{const r=parsedRows[0];r.overrideStatus='Hold';r.overrideCause='them';r.overrideNotes='Customer asked';return renderRowsTable([r],{key:'t',title:'T',editable:true});})()");
  assert.match(row, /class="table editable-rows"/);
  assert.match(row, /<span class="ovr-text">Hold<\/span><span class="cause-tag them">Them<\/span><\/span><span class="ovr-note" title="Customer asked">Customer asked<\/span>/);
  assert.match(row, /<td class="c-edit print-hide" data-card="edit"><button type="button" class="note-btn has-note"/);
  assert.match(printCss(), /\.ovr-note\{white-space:normal;max-width:none\}/);
  assert.match(printCss(), /tr\.note-editor-row\{display:none!important\}/);
  assert.match(printCss(), /\.editable-rows \.row-override,\.editable-rows \.row-note\{display:none!important\}/);
});

// The Ask AI key field (.ai-field input) left with the Gemini panel in 1v9 (keys are server secrets now); the
// editor's name field from shared notes (1v7; initials until 2v2) takes its place in the check.
test('empty text fields have a 3:1 border (search, Ask AI question, note editors, editor name)', () => {
  for (const sel of ['.note-editor textarea', '.sidebar-search input', '.ai-compose textarea', '.editor-form input']) {
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

test('Metrics: "Rescheduled, commit ahead" counts the same lines as the timeline Rescheduled column', async () => {
  const page = await loaded([
    sapRow({ DocumentNumber: '1', RescheduleDate: '10/01/2026', LineRescheduleDate: '10/01/2026', RescheduleFlag: 'Rescheduled' }), // into next month: Open Next Month
    sapRow({ DocumentNumber: '2', RescheduleDate: '11/15/2026', LineRescheduleDate: '11/15/2026', RescheduleFlag: 'Rescheduled' }),
    sapRow({ DocumentNumber: '3' }),
  ]);
  page.run('setTab("metrics")');
  const strip = Number(html(page).match(/Rescheduled, commit ahead[\s\S]*?class="ms-big[^>]*>(\d+)</)[1]);
  assert.equal(strip, page.run('currentMetrics().metricTimeline.reduce((s,g)=>s+g.rescheduledRows,0)'));
  assert.equal(strip, 1);
});

test('ranked lists give names the larger column (own line on phones) and the full name on hover', async () => {
  // Headless Chrome with the real files: names cut at 375px 14 -> 0 (Build Risk), at 1024px 8 -> 4 of 16 (Warehouse Timeline, all with titles).
  assert.match(CSS, /\.rank-row\{display:grid;grid-template-columns:minmax\(0,2fr\) minmax\(48px,1fr\) 84px;/);
  assert.match(CSS, /\.rank-row\.wide\{grid-template-columns:minmax\(0,2fr\) minmax\(48px,1fr\) 96px\}/);
  assert.ok(CSS.includes('@media (max-width:640px){.rank-row{grid-template-columns:minmax(0,1fr) 84px;row-gap:6px}.rank-row.wide{grid-template-columns:minmax(0,1fr) 96px}.rank-row .rank-name{grid-column:1/-1}}'));
  const page = await loaded(Array.from({ length: 6 }, (_, i) => sapRow({ DocumentNumber: String(10 + i), Warehouse: 'Spyder - Lacombe Long Name' })));
  assert.match(page.run("renderRankRows([{label:'CM - Augusta',sub:'3 lines',value:1,text:'1'},{label:'<b>',value:2,text:'2'}])"), /title="CM - Augusta · 3 lines"[\s\S]*title="&lt;b&gt;"/);
  page.run('setTab("warehouses")');
  assert.match(html(page), /<div class="rank-row" title="Spyder - Lacombe Long Name · \d+ on-track of 6 open lines"><span class="rank-name">Spyder - Lacombe Long Name<\/span>/);
});

test('Top offenders waffle rows and rank items stay inside their card with a long name (one shrinkable column)', () => {
  // Headless Chrome, a 49-character customer name: before, 375px scrolled sideways (471px) and print cut "$10…" at the
  // paper edge; with one minmax(0,1fr) column the name truncates and every value stays inside the card.
  assert.ok(CSS.includes('.waffle-list{display:grid;grid-template-columns:minmax(0,1fr);gap:2px}'));
  assert.match(CSS, /\.waffle-row\{[^}]*display:grid;grid-template-columns:minmax\(0,1fr\);min-width:0;/);
  assert.match(CSS, /\.rank-item\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:4px;min-width:0\}/);
  assert.match(CSS, /\.rank-name\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
});

test('chart axis labels wrap at their space instead of being clipped mid-word', () => {
  // Headless Chrome: Metrics at 1024px and Order Health / Monthly at 375px now show "Aug" over "'26", "Sep" over "13", no clipping.
  const rules = (sel) => [...CSS.matchAll(new RegExp(`(?:^|\\}|,)\\s*${sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')}(?:,[^{]*)?\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]).join(';');
  for (const sel of ['.col-labels>span', '.pair-labels>span']) {
    const r = rules(sel);
    assert.ok(r.length, sel);
    assert.ok(!/white-space:nowrap|text-overflow:clip|overflow:hidden/.test(r), `${sel}: ${r}`);
  }
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
  assert.match(html(page), /Showing 90 of 90 lines/);
  page.run('endPrintMode();setTab("purchaseorders")');
  assert.equal(lines(), 20);
  page.run('refreshForPrint()');
  assert.equal(lines(), 105);
  page.run('endPrintMode()');
  assert.equal(lines(), 20);
});

run();
