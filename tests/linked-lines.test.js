// Order Health "Linked lines" table: row selection, bulk override, delete / restore, column sorts.
// Run with `node tests/linked-lines.test.js`. Fixtures are synthetic (no SAP data).
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

// Export date is 09/03/2026, so every line due in August is past due and lands on the At Risk card.
const pastDue = (n) => Array.from({ length: n }, (_, i) => sapRow({ DocumentNumber: String(1000 + i), 'Internal Number': String(1000 + i) }));
// Four At Risk lines with a different value in every column (doc numbers 9 / 10 / 55 / 100 test numeric order).
const SORT_ROWS = [
  sapRow({ DocumentNumber: '9', 'Internal Number': '9', CustomerVendorName: 'Charlie', Warehouse: 'Spyder - Lacombe', 'Item No.': 'B-200', DocumentDate: '07/01/2026', DueDate: '08/20/2026', LineDueDate: '08/20/2026', HeaderDueDate: '08/20/2026', Quantity: '30', OpenQuantity: '30', AmountLocal: '3,000.00' }),
  sapRow({ DocumentNumber: '10', 'Internal Number': '10', CustomerVendorName: 'alpha', Warehouse: 'CM - Alpha', 'Item No.': 'A-100', DocumentDate: '06/01/2026', DueDate: '08/05/2026', LineDueDate: '08/05/2026', HeaderDueDate: '08/05/2026', Quantity: '5', OpenQuantity: '5', AmountLocal: '9,000.00', LineRescheduleDate: '09/20/2026', RescheduleDate: '09/20/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' }),
  sapRow({ DocumentNumber: '100', 'Internal Number': '100', CustomerVendorName: 'Bravo', Warehouse: 'CM SFG - Zed', 'Item No.': 'C-300', DocumentDate: '08/01/2026', DueDate: '08/25/2026', LineDueDate: '08/25/2026', HeaderDueDate: '08/25/2026', Quantity: '12', OpenQuantity: '12', AmountLocal: '100.00', LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', RescheduleFlag: 'No Commit Date' }),
  sapRow({ DocumentNumber: '55', 'Internal Number': '55', CustomerVendorName: 'Delta', Warehouse: 'Main', 'Item No.': 'A-050', DocumentDate: '08/10/2026', DueDate: '08/15/2026', LineDueDate: '08/15/2026', HeaderDueDate: '08/15/2026', Quantity: '1', OpenQuantity: '1', AmountLocal: '500.00', LineRescheduleDate: '08/28/2026', RescheduleDate: '08/28/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' }),
];

async function atRiskPage(rows, opts) {
  const page = loadPage(opts);
  // The DOM stub makes every harness page start as an empty shared snapshot; a real page starts with the
  // browser's saved overrides, so start from those (as a fresh browser tab does).
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false;rowOverrides=loadRowOverrides()');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  page.run("setTab('weekly');weeklyTileFilter='late';renderResults()");
  return page;
}
const html = (page) => page.els['results-screen'].innerHTML;
const shownDocs = (page) => [...html(page).matchAll(/<td class="c-doc">([^<]*)<\/td>/g)].map((m) => m[1]);
const atRiskCount = (page) => page.run('orderHealthData(currentMetrics()).lateTileRows.length');
const keyOf = (page, doc) => page.run(`rowKey(allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(doc)}))`);
const saved = (page) => JSON.parse(page.storage.spyderKpiRowOverridesV1 || '{}');

test('select all covers every row of the list, not just the 20 shown; partial selection is indeterminate', async () => {
  const page = await atRiskPage(pastDue(25));
  assert.equal(shownDocs(page).length, 20);
  page.run('selectAllLinked(true)');
  assert.equal(page.run('linkedSelection.size'), 25);
  assert.match(html(page), /id="linked-select-all" class="row-check" checked/);
  assert.match(html(page), /<span class="bulk-count">25 selected<\/span>/);
  // Every override choice is offered, with '' shown as "No override".
  const options = [...html(page).match(/<select id="linked-bulk-status"[\s\S]*?<\/select>/)[0].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(options, page.run('OVERRIDE_OPTIONS').map((o) => o.replace(/&/g, '&amp;')));
  page.run(`toggleLinkedRow(${JSON.stringify(keyOf(page, '1000'))},false)`);
  assert.equal(page.run('linkedSelection.size'), 24);
  assert.doesNotMatch(html(page), /id="linked-select-all" class="row-check" checked/);
  await Promise.resolve();
  assert.equal(page.els['linked-select-all'].indeterminate, true);
  // A key that is no longer in the list is pruned on the next draw; changing the card clears the selection.
  page.run("linkedSelection.add('gone');renderResults()");
  assert.equal(page.run("linkedSelection.has('gone')"), false);
  page.run("setWeeklyTileFilter('allorders')");
  assert.equal(page.run('linkedSelection.size'), 0);
  assert.doesNotMatch(html(page), /bulk-actions/);
});

test('bulk override applies to every selected line, keeps notes, migrates legacy keys, saves and redraws once', async () => {
  const page = await atRiskPage(pastDue(4));
  const [k0, k1, k2, k3] = ['1000', '1001', '1002', '1003'].map((d) => keyOf(page, d));
  page.run(`updateRowOverride(${JSON.stringify(k0)},'notes','Customer agreed to wait')`);
  // An entry saved under the older key format (with the due date) moves to the current key.
  const legacy = page.run("legacyRowKey(allLoadedRows.find(r=>r.documentNumber==='1001'))");
  page.run(`rowOverrides[${JSON.stringify(legacy)}]={notes:'Old note'};allLoadedRows.forEach(applyRowOverride)`);
  [k0, k1, k2].forEach((k) => page.run(`toggleLinkedRow(${JSON.stringify(k)},true)`));
  page.run("var calls={render:0,save:0,inval:0};(()=>{const r=renderResults,s=saveRowOverrides,i=invalidateMetrics;renderResults=function(){calls.render++;return r()};saveRowOverrides=function(){calls.save++;return s()};invalidateMetrics=function(){calls.inval++;return i()};})()");
  page.run("linkedBulkStatus='Hold';applyLinkedOverride()");
  assert.deepEqual(page.run('calls'), { render: 1, save: 1, inval: 1 });
  const status = (d) => page.run(`allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(d)}).overrideStatus`);
  assert.deepEqual(['1000', '1001', '1002', '1003'].map(status), ['Hold', 'Hold', 'Hold', '']);
  const store = saved(page);
  assert.deepEqual(store[k0], { notes: 'Customer agreed to wait', status: 'Hold' });
  assert.deepEqual(store[k1], { notes: 'Old note', status: 'Hold' });
  assert.equal(store[legacy], undefined);
  assert.equal(store[k3], undefined);
  // "No override" clears the status and still keeps the notes.
  page.run("linkedBulkStatus='';applyLinkedOverride()");
  assert.deepEqual(saved(page)[k0], { notes: 'Customer agreed to wait', status: '' });
  assert.equal(saved(page)[k2], undefined);
  // Not At Risk takes the lines off the At Risk card.
  page.run("linkedBulkStatus='Not At Risk';applyLinkedOverride()");
  assert.equal(atRiskCount(page), 1);
  assert.equal(page.run('linkedSelection.size'), 0);
});

test('delete hides lines from every KPI, persists, travels in snapshots, and restore brings them back', async () => {
  const rows = pastDue(5);
  const page = await atRiskPage(rows);
  assert.equal(atRiskCount(page), 5);
  const [k0, k1] = [keyOf(page, '1000'), keyOf(page, '1001')];
  page.run(`updateRowOverride(${JSON.stringify(k0)},'notes','Duplicate line')`);
  [k0, k1].forEach((k) => page.run(`toggleLinkedRow(${JSON.stringify(k)},true)`));
  // Cancelling the confirm deletes nothing.
  page.ctx.confirm = () => false;
  page.run('deleteLinkedSelection()');
  assert.equal(atRiskCount(page), 5);
  let asked = '';
  page.ctx.confirm = (m) => { asked = m; return true; };
  page.run('deleteLinkedSelection()');
  assert.match(asked, /Delete 2 selected lines/);
  assert.equal(atRiskCount(page), 3);
  assert.equal(page.run('parsedRows.length'), 3);
  assert.equal(page.run('currentMetrics().rows.length'), 3);
  assert.equal(page.run('linkedSelection.size'), 0);
  assert.deepEqual(saved(page)[k0], { notes: 'Duplicate line', deleted: true });
  assert.deepEqual(saved(page)[k1], { deleted: true });
  // Including non-inventory lines does not bring deleted lines back.
  page.run('setIncludeNonInventory(true)');
  assert.equal(page.run('parsedRows.length'), 3);
  // The Data check pill appears and lists the deleted lines with Restore buttons.
  assert.match(html(page), /Data check<\/summary><div class="data-check-pop"><strong>2 lines you deleted are hidden/);
  assert.match(html(page), /onclick="restoreDeletedLines\(\)">Restore all/);
  assert.equal([...html(page).matchAll(/class="dc-restore link-btn"/g)].length, 2);
  assert.match(html(page), /<li><span>1000 · Firefly RV · SPY-100<\/span>/);

  // Same browser storage, same file: still hidden.
  const again = await atRiskPage(rows, { storage: page.storage });
  assert.equal(atRiskCount(again), 3);

  // A share snapshot carries every row plus the deleted flags, so the lines stay hidden there too.
  const snap = loadPage();
  snap.els['embedded-snapshot-data'].dataset.encoding = 'json';
  snap.els['embedded-snapshot-data'].textContent = page.run("JSON.stringify({parsedRows:allLoadedRows,rowOverrides,weeklyTileFilter:'late'})");
  await snap.run('loadEmbeddedSnapshot()');
  assert.equal(snap.run('allLoadedRows.length'), 5);
  assert.equal(atRiskCount(snap), 3);

  page.run(`restoreDeletedLines(${JSON.stringify(k1)})`);
  assert.equal(atRiskCount(page), 4);
  assert.equal(saved(page)[k1], undefined);
  assert.match(html(page), /1 line you deleted is hidden/);
  page.run('restoreDeletedLines()');
  assert.equal(atRiskCount(page), 5);
  assert.deepEqual(saved(page), { [k0]: { notes: 'Duplicate line' } });
  assert.doesNotMatch(html(page), /you deleted/);
});

test('in a shared snapshot, delete is for this tab only and says so; focus stays in the table; restore buttons name their line', async () => {
  const src = await atRiskPage(pastDue(3));
  const snap = loadPage();
  snap.els['embedded-snapshot-data'].dataset.encoding = 'json';
  snap.els['embedded-snapshot-data'].textContent = src.run("JSON.stringify({parsedRows:allLoadedRows,rowOverrides,weeklyTileFilter:'late'})");
  await snap.run('loadEmbeddedSnapshot()');
  // Clear selection removes the button that had focus; focus moves to the select-all box instead of the page.
  let focused = 0;
  snap.ctx.document.getElementById('linked-select-all').focus = () => { focused++; };
  snap.ctx.document.activeElement = snap.ctx.document.body;
  snap.run(`toggleLinkedRow(${JSON.stringify(keyOf(snap, '1000'))},true);selectAllLinked(false)`);
  assert.equal(focused, 1);
  let asked = '';
  snap.ctx.confirm = (m) => { asked = m; return true; };
  snap.run(`toggleLinkedRow(${JSON.stringify(keyOf(snap, '1000'))},true);deleteLinkedSelection()`);
  assert.match(asked, /in this tab until it is closed/);
  assert.equal(focused, 2);
  assert.equal(atRiskCount(snap), 2);
  assert.deepEqual(snap.storage, {});
  assert.match(html(snap), /aria-label="Restore 1000 SPY-100"/);
});

test('every column header sorts the list ascending and descending on the values shown', async () => {
  const page = await atRiskPage(SORT_ROWS);
  // Ascending order for each column; blanks and the no-commit / no-reschedule badges stay after the dated lines.
  const asc = {
    doc: ['9', '10', '55', '100'],
    customer: ['10', '100', '9', '55'],
    warehouse: ['10', '100', '55', '9'],
    item: ['55', '10', '9', '100'],
    date: ['10', '55', '9', '100'],
    qty: ['55', '10', '100', '9'],
    value: ['100', '55', '9', '10'],
    status: ['9', '55', '100', '10'],
    reschedule: ['55', '10', '100', '9'],
    lead: ['55', '100', '9', '10'],
  };
  const desc = { reschedule: ['10', '55', '100', '9'] };
  for (const [col, order] of Object.entries(asc)) {
    page.run(`weeklyLineSort='col:${col}:asc';renderResults()`);
    assert.deepEqual(shownDocs(page), order, `${col} ascending`);
    assert.match(html(page), new RegExp(`<th(?: class="num")? aria-sort="ascending"><button type="button" class="th-sort" data-focus-key="linked-sort-${col}"`));
    page.run(`weeklyLineSort='col:${col}:desc';renderResults()`);
    assert.deepEqual(shownDocs(page), desc[col] || [...order].reverse(), `${col} descending`);
  }
  // Header clicks: text columns start A to Z, amounts start high to low, a second click flips.
  page.run("weeklyLineSort='default';sortLinkedColumn('customer')");
  assert.equal(page.run('weeklyLineSort'), 'col:customer:asc');
  page.run("sortLinkedColumn('customer')");
  assert.equal(page.run('weeklyLineSort'), 'col:customer:desc');
  page.run("sortLinkedColumn('value')");
  assert.equal(page.run('weeklyLineSort'), 'col:value:desc');
  assert.match(html(page), /<option value="col:value:desc" selected>Column: Value ↓<\/option>/);
  // The Sort rows select still switches back to its own choices.
  page.run("setWeeklyLineSort('default')");
  assert.doesNotMatch(html(page), /Column: |aria-sort/);
});

run();
