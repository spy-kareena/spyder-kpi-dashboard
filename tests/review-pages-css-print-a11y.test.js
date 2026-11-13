// Review fixes: page layout, CSS contrast, print output and accessibility. Run with `node tests/review-pages-css-print-a11y.test.js`.
// Fixtures are synthetic (harness.js); no SAP data.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const CSS = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const html = (page) => page.els['results-screen'].innerHTML;
const unesc = (v) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
async function loaded(rows = [sapRow({})]) {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}

test('ship target dates: keyboard edits wait for Enter or blur, calendar picks apply at once', async () => {
  const page = await loaded();
  // 2v6.9: the ship target is a card on Sales Order Health > Leading (it was on Monthly); Dates opens its date fields.
  page.run('setTab("weekly");setWeeklyView("leading");toggleTableMore("mwm-dates");window.__renders=0;renderResults=(f=>function(){window.__renders++;return f.apply(this,arguments);})(renderResults)');
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

// 2v6: the Order Health scorecard and the Purchase Orders by-warehouse rows left those pages; their rows live on as
// Warehouses to watch and Which warehouse is defaulting on the Warehouse Timeline (hidden by default, 2v6.9).
test('warehouse rows name each value by its column with full amounts', async () => {
  const page = await loaded(MIX);
  for (const t of ['weekly', 'purchaseorders']) {
    page.run(`setTab(${JSON.stringify(t)})`);
    assert.doesNotMatch(html(page), /class="(?:thead|trow) (?:sc|po-wh)-cols/, `${t}: no scorecard rows (moved to Warehouse Timeline)`);
  }
  page.run("stgSet('hiddenPages',[]);setTab('warehouses')");
  const m = html(page);
  // The row's name is its tip in plain words, amounts in full: never "$1K" in a row name.
  const row = m.match(/<button type="button" class="dz-tr mwm-wrow[^"]*" data-focus-key="sc-Spyder - Lacombe"[^>]*>/)[0];
  assert.match(row, /aria-label="Spyder - Lacombe; Open \$1,000, at risk \$1,000; 1 past due; OTD no data, fill 0%, reschedule hit no data\. Click to filter to it\." data-tip="Spyder - Lacombe\n• Open \$1,000, at risk \$1,000\n• 1 past due\n• OTD no data, fill 0%, reschedule hit no data\nClick to filter to it\."/);
  assert.doesNotMatch(m, /<button[^>]*class="(?:dz-tr mwm-wrow|trow wl-cols)[^"]*"[^>]*aria-label="[^"]*\$[\d.]+[KM]\b/, 'no short money in a row name');
});

// KNOWN BUG (left failing on purpose, see the 2v6.9 test round report): rows named by the plain form of their tip
// (aria-label = ohlPlain(tip): Warehouses to watch, its subtotals, Which warehouse is defaulting) also get the tip as an
// aria-describedby description, because wireTip only skips a tip equal to the aria-label or the visible text. Screen
// readers then hear every number twice (name, then description). wireTip should also treat ohlPlain(tip) as shown.
test('BUG: a row named by its tip in plain words is read once (no description repeating it; wireTip vs ohlPlain)', async () => {
  const page = await loaded(MIX);
  page.run("stgSet('hiddenPages',[]);setTab('warehouses')");
  const m = html(page);
  const named = [...m.matchAll(/<(?:button|div) [^>]*aria-label="([^"]+)" data-tip="([^"]+)"/g)].filter((x) => x[2].includes('\n'));
  assert.ok(named.length >= 3, 'rows named by their tip');
  for (const [, label, tipText] of named) {
    page.ctx.__el = { attrs: { 'aria-label': unesc(label), 'data-tip': unesc(tipText) }, textContent: '', getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }, setAttribute(n, v) { this.attrs[n] = String(v); }, removeAttribute(n) { delete this.attrs[n]; } };
    page.run('wireTip(__el)');
    assert.equal(page.ctx.__el.attrs['aria-describedby'], undefined, `read twice: ${label}`);
  }
});

test('heat map is an ARIA table; cells are focusable with their breakdown as text (and tip); badge has no aria-label; the legend names it', async () => {
  const page = await loaded(MIX);
  page.run("stgSet('hiddenPages',[])"); // 2v6.9: Warehouses is hidden by default; Settings > Hidden Pages brings it back
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
  assert.match(m, /<span class="sr-only">, Spyder - Lacombe · [^<]*open; 1 line[^<]*late[^<]*<\/span>/);
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
  // (.nav-label, .loaded-label and the sidebar search left with the sidebar in 2v6; the header search pill is below.)
  for (const sel of ['.muted', '.kpi-tag', '.bullet-scale', '.rank-no', '.table-tools .hint', '.ai-foot', '.heat-0', '.data-table .muted']) {
    assert.match(CSS, new RegExp(`(^|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*color:var\\(--gray-500\\)`, 'm'), sel);
  }
  assert.match(CSS, /\.lines-table \.c-item \.desc\{color:var\(--gray-500\)/);
  for (const bg of ['white', 'gray-50', 'accent-tint']) assert.ok(ratio('gray-500', bg) >= 4.5, bg);
  // 2v6 tokens: the quiet text inks read at 4.5:1 on a white card; --dz-ink-4 (stat labels, sub-lines) also on the page
  // background. --dz-ink-5 (dashes, the header search's placeholder on its white pill) is 4.44:1 on the bare page
  // background, so it stays on cards and pills.
  assert.match(CSS, /\.hdr-search input::placeholder\{color:var\(--dz-ink-5\)\}/);
  for (const [ink, bg] of [['dz-ink-4', 'white'], ['dz-ink-4', 'dz-page-bg'], ['dz-ink-5', 'white']]) assert.ok(ratio(ink, bg) >= 4.5, `${ink} on ${bg}: ${ratio(ink, bg).toFixed(2)}`);
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
  // (The sidebar's .nav-badge left in 2v6; the header gear's dot carries no text.)
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

// 2v6: Build Risk lists its orders in its own table (sup-br); the Cause control and Us / Them tags were removed on
// purpose (2v6), so a row prints the override and the note.
async function buildRiskWithNote(note) {
  const page = loadPage();
  const csv = new Uint8Array(Buffer.from('CM,Month,Total,Clear To Build,At Risk,Late\r\nDSM,Aug 2026,5,3,2,0\r\n'));
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({ DocumentNumber: '71001', Warehouse: 'CM - DSM' })]) }, { name: 'ctb.csv', bytes: csv }]);
  const key = JSON.stringify(page.run("rowKey(parsedRows.find(r=>r.documentNumber==='71001'))"));
  page.run(`updateRowOverride(${key},'status','Hold');updateRowOverride(${key},'notes',${JSON.stringify(note)});stgSet('hiddenPages',[]);setTab('buildrisk')`);
  return { page, key };
}
test('print: Build Risk rows print the override and note as text; the Edit button and the editor stay off paper', async () => {
  const { page, key } = await buildRiskWithNote('Customer asked');
  let m = html(page);
  assert.match(m, /<td class="sup-ovr" data-label="Override"><div class="sup-ovr-in"><span class="sup-ovr-t">Hold<span class="sup-sub" title="Customer asked">Customer asked<\/span><\/span><span class="sup-ovr-b print-hide"><button type="button" class="note-btn has-note"/);
  assert.doesNotMatch(m, /cause-tag/);
  page.run(`toggleRowNote(${key})`);
  m = html(page);
  assert.match(m, /<tr class="note-editor-row print-hide"><td colspan="8">/);
  assert.match(printCss(), /tr\.note-editor-row\{display:none!important\}/);
  assert.match(printCss(), /,\.print-hide,[^{}]*\{display:none!important\}/);
});

// KNOWN BUG (left failing on purpose, see the 2v6.9 test round report): the Build Risk override cell (.sup-ovr-t) is one
// line (white-space:nowrap; overflow:hidden; text-overflow:ellipsis) and its note (.sup-sub) inherits that. On screen
// the full note is the title tip. In print no rule lets the cell wrap, so the note stays on one line: headless
// Chromium at letter width with a 95-character note draws the table 936px wide in a 791px box, running the row off the
// paper. (The old .ovr-note had @media print{.ovr-note{white-space:normal;max-width:none}}.)
test('BUG: print lets the Build Risk override cell wrap, so a long note fits the page (.sup-ovr-t)', async () => {
  assert.match(CSS, /\.sup-ovr-t\{[^}]*white-space:nowrap/);
  const pr = printCss().match(/[^{}]*\.sup-ovr-t[^{}]*\{[^}]*\}/g) || [];
  assert.ok(pr.some((r) => /white-space:normal/.test(r) && /overflow:visible/.test(r)), 'a print rule lets .sup-ovr-t (and its note) wrap');
});

// The Ask AI key field (.ai-field input) left with the Gemini panel in 1v9 (keys are server secrets now); the
// editor's name field from shared notes (1v7; initials until 2v2) takes its place in the check.
// KNOWN BUG (left failing on purpose, see the 2v6.9 test round report; WCAG 2.2 SC 1.4.11 Non-text Contrast): the 2v6
// pill fields draw their edge in --dz-line-8, rgba(12,26,44,.08), about 1.2:1 against a white card (3:1 needed), so an
// empty field is hard to see. The last (winning) border rule is checked for each field.
const lastBorder = (sel) => {
  const rules = [...CSS.matchAll(new RegExp(`(?:^|\\}|,)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:,[^{]*)?\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]);
  let colour = '';
  for (const r of rules) {
    const b = r.match(/(?:^|;)border(?:-color)?:(?:\d+px solid )?([^;]+)/);
    if (b) colour = b[1].trim();
  }
  return colour;
};
// A colour as it shows on white: tokens resolved from :root, rgba blended over white.
const ROOT = CSS.match(/:root\{([\s\S]*?)\}/)[1];
const onWhite = (c) => {
  const v = c.match(/^var\(--([\w-]+)\)$/);
  if (v) return onWhite((ROOT.match(new RegExp(`--${v[1]}:([^;]+);`)) || [])[1] || '');
  const a = c.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
  if (a) return `#${[1, 2, 3].map((i) => Math.round(255 - (255 - +a[i]) * +a[4]).toString(16).padStart(2, '0')).join('')}`;
  return c;
};
test('BUG: empty text fields have a 3:1 border (header search, Ask AI question, note editors, editor name, pill fields)', () => {
  const fields = ['.hdr-search.open', '.ai-compose textarea', '.note-editor textarea', '.sup-page .note-editor textarea', '.editor-form input', '.dz-pillinput'];
  const weak = fields.map((sel) => [sel, lastBorder(sel)]).map(([sel, c]) => [sel, c, ratio(onWhite(c), '#ffffff')]).filter(([, , r]) => !(r >= 3));
  assert.deepEqual(weak.map(([sel, c, r]) => `${sel}: ${c} ${r.toFixed(2)}:1`), []);
});

// 2v6.9: Metrics is a part of Sales Order Health > Lagging. Lagging, Version 1 (owner): its KPI tiles, the On-time chart
// and the Monthly metrics table are one Trend card and one Month by month table now; Fill rate and On-track rate are on
// neither (Fill rate left with the old tables, On-track rate with Order quality).
test('Fill rate and On-track rate show no made-up 0% when no sales-order lines are loaded', async () => {
  // Everything from the Trend card to the end of the Lagging panel: Trend, Month by month, By warehouse, Booked vs shipped.
  const detail = (h) => h.slice(h.indexOf('<div class="dz-grid ohg-detail">'), h.indexOf('<div class="oh-panel"', h.indexOf('id="ohg-metrics"')));
  const cards = (m) => Object.fromEntries([...m.matchAll(/<section class="dz-card[^"]*"[^>]*>[\s\S]*?<\/section>/g)].map((x) => [x[0].match(/<h2 class="dz-title"[^>]*>([^<]*)<\/h2>/)[1], x[0]]));
  const cells = (card) => [...card.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '')));
  // The tiles' markup (the change beside the Trend card's figure keeps the tiles' mwm-kpi-d pill).
  const NO_TILES = /class="mwm-kpi[ "]|mwm-kpi-[lv]|Fill rate|On-track rate/;
  const page = await loaded([PO({ DocumentNumber: '700' })]);
  page.run('setTab("metrics")');
  assert.deepEqual(page.run('[activeTab,weeklyView]'), ['weekly', 'lagging']);
  let m = detail(html(page));
  // No sales-order lines: the Trend card says so and nothing else is drawn (no chart, no tables, no rates).
  assert.deepEqual(Object.keys(cards(m)), ['Trend']);
  assert.match(cards(m).Trend, /^<section class="dz-card dz-span-6" id="ohg-metrics"><div class="dz-card-head"><h2 class="dz-title">Trend<\/h2><\/div><p class="empty-note">No order lines are loaded yet\.<\/p><\/section>$/);
  assert.doesNotMatch(m, /Fill rate|On-track rate|\d%|<table|mwm-plot|ohgt-chip/);
  assert.deepEqual(page.errors, []);

  // One open line due Aug 1 and nothing shipped: every rate is a dash, never 0%.
  const so = await loaded([sapRow({ DocumentNumber: '1' })]);
  so.run('setTab("metrics")');
  m = detail(html(so));
  let c = cards(m);
  assert.deepEqual(Object.keys(c), ['Trend', 'Month by month', 'By warehouse', 'Booked vs shipped']);
  // (Fill rate left with the Metrics tiles and the old month tables, On-track rate with Order quality: owner.)
  assert.doesNotMatch(m, NO_TILES);
  assert.match(c.Trend, /<h3[^>]*>On-time delivery · August<\/h3>\s*<div class="ohgt-now"><span>—<\/span><\/div>/);
  assert.doesNotMatch(c.Trend, /class="mwm-pt"/); // no month has a delivery, so the chart has no dot
  assert.match(c.Trend, /<h3[^>]*>Why orders were late · August<\/h3><p class="ohgt-none">No late orders\.<\/p>/);
  assert.match(c.Trend, /<b>September so far:<\/b> 0 orders · \$0 shipped · year to date \$0<\/p>/);
  assert.deepEqual(cells(c['Month by month']), ['Sep 2026 to date', 'Aug 2026', 'Jul 2026', 'Jun 2026', 'May 2026', 'Apr 2026'].map((mo) => [mo, '0', '$0', '—', '—', '—', '0']));
  // The only percentages on the two cards are the chart's axis (50% to 100%).
  assert.deepEqual([...(c.Trend + c['Month by month']).replace(/<button\b[^>]*>[^<]*<\/button>/g, '').replace(/data-tip="[^"]*"/g, '').matchAll(/>(\d+%)</g)].map((x) => x[1]), ['100%', '75%', '50%']);
  assert.match(c['By warehouse'], /<span class="dz-meta">September · 0 orders<\/span><\/div><p class="empty-note">No deliveries in this range\.<\/p>/);
  // Booked vs shipped has a real 0%: $1,000 was booked for August and none of it has shipped.
  assert.deepEqual(cells(c['Booked vs shipped']), [['Aug 2026', '0%', '$1,000', '0']]);
  assert.match(c['Booked vs shipped'], /<tr data-tip="Aug 2026\n• \$0 shipped of \$1,000 booked\n• 1 open line · 0 closed lines\n• 10 qty open">/);
  assert.deepEqual(so.errors, []);

  // With deliveries the Trend card and the Month by month table score them: in August one order 2 days early and one
  // 6 days late (SAP marks it Not Perfect), in September (the report month) one on its date.
  const closed = (doc, d, o = {}) => sapRow({ DocumentNumber: doc, DueDate: d, HeaderDueDate: d, LineDueDate: d, Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0', FillStatus: 'Complete', ...o });
  const pair = (doc, d, shippedOn, amount, o = {}) => [closed(doc, d, { AmountLocal: '0', ...o }),
    closed(doc, d, { OrderType: 'Sales Delivery', ClosedDate: shippedOn, CloseDateSource: 'Delivery', DeliveryDocNumber: `D${doc}`, AmountLocal: amount, ...o })];
  const sh = await loaded([sapRow({ DocumentNumber: '1' }), ...pair('2', '08/20/2026', '08/18/2026', '1,200.00', { PerfectOrder: 'Perfect' }), ...pair('3', '08/20/2026', '08/26/2026', '800.00'),
    ...pair('4', '09/01/2026', '09/01/2026', '500.00', { PerfectOrder: 'Perfect', Warehouse: 'CM - Alta' })]);
  sh.run('setTab("metrics")');
  m = detail(html(sh));
  c = cards(m);
  assert.deepEqual(cells(c['Month by month']), [
    ['Sep 2026 to date', '1', '$500', '100%', '100%', '0.0', '0'],
    ['Aug 2026', '2', '$2K', '50%', '50%', '6.0', '1'],
    ...['Jul 2026', 'Jun 2026', 'May 2026', 'Apr 2026'].map((mo) => [mo, '0', '$0', '—', '—', '—', '0']),
  ]);
  assert.match(c['Month by month'], /<span class="dz-chip teal">100%<\/span>[\s\S]*<span class="dz-chip red">50%<\/span>[\s\S]*<td class="num late">1<\/td>/);
  assert.match(c['Month by month'], /<span class="dz-pagecount">1–6 of 12 months<\/span>/);
  // The side panel is the newest month with a shipment (September, still running) against the month before.
  assert.match(c.Trend, /<h3[^>]*>On-time delivery · September to date<\/h3>\s*<div class="ohgt-now"><span>100%<\/span><span class="mwm-kpi-d teal">\+50 pts vs Aug<\/span><\/div>/);
  assert.deepEqual([...c.Trend.matchAll(/<span class="mwm-pt"[^>]*data-tip="([^"]+)"><\/span><span class="mwm-pt-l"[^>]*>([^<]*)<\/span>/g)].map((x) => [x[1], x[2]]),
    [['August 2026: On-time delivery 50%\n• 2 orders shipped\n• 1 order late', '50%'], ['September 2026: On-time delivery 100%\n• 1 order shipped\n• 0 orders late', '100%']]);
  assert.match(c.Trend, /<h3[^>]*>Why orders were late · September<\/h3><p class="ohgt-none">No late orders\.<\/p>/);
  assert.match(c.Trend, /<p class="ohgt-sofar" data-tip="September so far\n• 1 order shipped, \$500 on 1 delivery line\n• Year to date: \$2,500 on 3 delivery lines"><b>September so far:<\/b> 1 order · \$500 shipped · year to date \$3K<\/p>/);
  assert.match(c['By warehouse'], /<span class="dz-meta">September · 1 order<\/span>/);
  // One month of deliveries: the Last 6 months cell is empty (a line needs two months).
  assert.deepEqual(cells(c['By warehouse']), [['CM · Alta', '1', '$500', '100%', '']]);
  assert.deepEqual(cells(c['Booked vs shipped']), [['Aug 2026', '67%', '$1,000', '1'], ['Sep 2026', '100%', '$0', '0']]);
  assert.doesNotMatch(m, NO_TILES);
  assert.deepEqual(sh.errors, []);
});

// The Metrics strip with "Rescheduled, commit ahead" left with Metrics' Show more (owner); nothing on Lagging draws it.
test('Metrics: no "Rescheduled, commit ahead" strip (its Show more was removed)', async () => {
  const page = await loaded([sapRow({ DocumentNumber: '1', RescheduleDate: '10/01/2026', LineRescheduleDate: '10/01/2026', RescheduleFlag: 'Rescheduled' }), sapRow({ DocumentNumber: '3' })]);
  page.run('setTab("metrics")');
  assert.doesNotMatch(html(page), /Rescheduled, commit ahead/);
  assert.deepEqual(page.errors, []);
});

// 2v6: the ranked lists (renderRankRows) left the pages; Warehouses to watch on the Warehouse Timeline is the warehouse
// list now: the name column is the widest, a long name is cut with "…" and the row's tip starts with the full name.
test('warehouse lists give names the larger column and the full name on hover', async () => {
  const page = await loaded(Array.from({ length: 6 }, (_, i) => sapRow({ DocumentNumber: String(10 + i), Warehouse: 'Spyder - Lacombe Long Name' })));
  page.run("stgSet('hiddenPages',[]);setTab('warehouses')");
  const m = html(page);
  assert.match(m, /<div class="mwm-table" style="--cols:minmax\(0,2fr\) repeat\(6,minmax\(0,\.7fr\)\);--cols-s:minmax\(0,2\.1fr\) repeat\(4,minmax\(0,\.8fr\)\);/);
  assert.match(CSS, /\.mwm-wname\{display:flex;align-items:center;gap:8px;min-width:0\}/);
  assert.match(CSS, /\.mwm-wtxt\{overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
  assert.match(m, /data-wh="Spyder - Lacombe Long Name"[^>]*data-tip="Spyder - Lacombe Long Name\n/);
  assert.match(m, /<span class="mwm-wtxt">Spyder · Lacombe Long Name<\/span>/);
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

test('Export PDF prints every linked line, not just the page on screen (Order Health, Purchase Orders)', async () => {
  const so = Array.from({ length: 90 }, (_, i) => sapRow({ DocumentNumber: String(1000 + i) }));
  const po = Array.from({ length: 105 }, (_, i) => PO({ DocumentNumber: String(5000 + i), DueDate: '08/10/2026', LineDueDate: '08/10/2026' }));
  const page = await loaded([...so, ...po]);
  const lines = () => html(page).split('class="line-row').length - 1;
  page.run('setTab("weekly")');
  assert.equal(lines(), 10);
  assert.match(html(page), /1–10 of 90 lines/);
  page.run('dzGoPage("oh-lines",9)');
  assert.match(html(page), /81–90 of 90 lines/);
  page.run('refreshForPrint()');
  assert.equal(lines(), 90);
  assert.doesNotMatch(html(page), /dz-pagefoot/);
  page.run('endPrintMode();setTab("purchaseorders")');
  const poLines = () => (html(page).match(/<td class="sup-strong" data-label="PO #">/g) || []).length;
  assert.equal(poLines(), 10);
  page.run('refreshForPrint()');
  assert.equal(poLines(), 105);
  page.run('endPrintMode()');
  assert.equal(poLines(), 10);
});

run();
