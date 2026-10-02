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

run();
