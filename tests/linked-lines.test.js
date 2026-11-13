// Order Health "Linked lines" table: row selection, bulk override, delete / restore, column sorts.
// Run with `node tests/linked-lines.test.js`. Fixtures are synthetic (no SAP data).
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
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
// Saved entries without the who / when stamp (by, at) every change carries since 1v7 (tests/shared-notes.test.js).
const saved = (page) => Object.fromEntries(Object.entries(JSON.parse(page.storage.spyderKpiRowOverridesV1 || '{}')).map(([k, { by, at, ...e }]) => [k, e]));
// The DOM stub has no live elements: fake the rendered controls a selector finds (data-key and focus() only).
function fakeControls(page, pattern, focused) {
  return [...html(page).matchAll(pattern)].map((m) => ({ dataset: { key: m[1].replace(/&amp;/g, '&') }, focus() { focused.push(this.dataset.key); } }));
}

test('select all covers every row of the list, not just the 10 on the page; partial selection is indeterminate', async () => {
  const page = await atRiskPage(pastDue(25));
  assert.equal(shownDocs(page).length, 10);
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
  // 2v7: the Settings Data Check card lists the deleted lines with Restore buttons (it was a pill in the page head);
  // deleted lines alone give the header gear a yellow dot.
  assert.doesNotMatch(html(page), /class="data-check/);
  assert.equal(page.run('stgDataCheckLevel()'), 'yellow');
  page.run("setTab('settings')");
  assert.match(html(page), /id="stg-card-dc"[\s\S]*?2 lines you deleted are hidden/);
  assert.match(html(page), /onclick="restoreDeletedLines\(\)">Restore all/);
  assert.equal([...html(page).matchAll(/class="dc-restore link-btn"/g)].length, 2);
  assert.match(html(page), /<li><span class="stg-dc-line">1000 · Firefly RV · SPY-100<\/span>/);

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
  assert.equal(page.run('stgDataCheckLevel()'), '');
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
  // 2v7: the Restore buttons are in the Settings Data Check card.
  snap.run("setTab('settings')");
  assert.match(html(snap), /aria-label="Restore 1000 SPY-100"/);
});

test('override select: stepping the closed select waits for Enter or blur, a pick from the list saves at once, a line leaving the list keeps focus nearby', async () => {
  const page = await atRiskPage(pastDue(3));
  const k0 = keyOf(page, '1000');
  page.run(`toggleRowNote(${JSON.stringify(k0)})`);
  const select = html(page).match(/<select class="row-override"[^>]*>/)[0];
  for (const ev of ['keydown', 'keyup', 'change', 'blur']) assert.match(select, new RegExp(`on${ev}="overrideSelectEvent\\(this,event\\)"`));
  // Windows fires change on every arrow key of a closed select: nothing is saved and the line stays, even past Not At Risk.
  page.run(`var sel={dataset:{key:${JSON.stringify(k0)}},value:''};var prevented=0;var key=(key,more)=>overrideSelectEvent(sel,{type:'keydown',key,preventDefault(){prevented++},...more});var arrow=v=>{key('ArrowDown');sel.value=v;overrideSelectEvent(sel,{type:'change'});}`);
  for (const v of ['Urgent', 'Close Short', 'Short Ship', 'Hold', 'Not At Risk', 'Shipping Delay']) {
    page.run(`arrow(${JSON.stringify(v)})`);
    assert.equal(saved(page)[k0], undefined, v);
    assert.equal(atRiskCount(page), 3, v);
  }
  // Enter saves the held change (and does not also open the list).
  page.run("key('Enter')");
  assert.deepEqual(saved(page)[k0], { status: 'Shipping Delay' });
  assert.equal(page.run('prevented'), 1);
  // With nothing held, Enter opens the list as usual; Enter, Space, F4 and Alt+Down open it and do not count as stepping.
  page.run("overrideSelectEvent(sel,{type:'keyup'});key('Enter');key(' ');key('F4');key('ArrowDown',{altKey:true})");
  assert.equal(page.run('prevented'), 1);
  // A pick from the open list (mouse, or arrows + Enter inside the list, which send no keydown to the select) saves at once.
  page.run("sel.value='Urgent';overrideSelectEvent(sel,{type:'change'})");
  assert.deepEqual(saved(page)[k0], { status: 'Urgent' });
  // Type-ahead letters step the closed select too.
  page.run("key('S');sel.value='Short Ship';overrideSelectEvent(sel,{type:'change'})");
  assert.deepEqual(saved(page)[k0], { status: 'Urgent' });
  page.run("overrideSelectEvent(sel,{type:'keyup'});key('Enter')");
  assert.deepEqual(saved(page)[k0], { status: 'Short Ship' });
  // Leaving the select saves a held change once the focus move has settled; a blur with nothing held saves nothing.
  page.run("arrow('Hold');overrideSelectEvent(sel,{type:'blur'})");
  assert.deepEqual(saved(page)[k0], { status: 'Short Ship' });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(saved(page)[k0], { status: 'Hold' });
  page.run("sel.value='';overrideSelectEvent(sel,{type:'blur'})");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(saved(page)[k0], { status: 'Hold' });

  // A committed Not At Risk takes the line off At Risk: focus goes to the line that took its place, and it is announced.
  const focused = [];
  const doc = page.ctx.document;
  doc.querySelectorAll = (s) => (s === 'button.note-btn' ? fakeControls(page, /<button type="button" class="note-btn[^"]*" data-key="([^"]*)"/g, focused) : []);
  doc.querySelector = (s) => (s === '[data-focus-key="tile-late"]' ? { focus() { focused.push('tile-late'); } } : null);
  doc.activeElement = doc.body;
  const before = doc.querySelectorAll('button.note-btn').map((b) => b.dataset.key);
  const at = before.indexOf(k0);
  page.run("overrideSelectEvent(sel,{type:'keyup'});sel.value='Not At Risk';overrideSelectEvent(sel,{type:'change'})");
  assert.equal(atRiskCount(page), 2);
  assert.deepEqual(focused, [before[at + 1]]);
  assert.equal(page.els['page-announce'].textContent, '1000 SPY-100 set to Not At Risk and left this list.');
  // A status that keeps the line in the list leaves focus to the redraw.
  page.run(`updateRowOverride(${JSON.stringify(before[at + 1])},'status','Urgent')`);
  assert.equal(focused.length, 1);
  // The last line leaving the list: focus the At Risk card.
  for (const k of before.filter((k) => k !== k0)) page.run(`updateRowOverride(${JSON.stringify(k)},'status','Not At Risk')`);
  assert.equal(atRiskCount(page), 0);
  assert.equal(focused[focused.length - 1], 'tile-late');
});

test('emptying the list focuses its KPI card; Restore focuses the next Restore button, else Data check or the page nav', async () => {
  const page = await atRiskPage(pastDue(3));
  const focused = [];
  const doc = page.ctx.document;
  const pageHtml = () => html(page) + page.els['app-sidebar'].innerHTML;
  // Controls exist only while the last render drew them; focus() records which one got focus.
  const getById = doc.getElementById;
  doc.getElementById = (id) => (id === 'linked-select-all' ? (pageHtml().includes('id="linked-select-all"') ? { focus() { focused.push(id); } } : null) : getById(id));
  doc.querySelector = (s) => {
    const fk = /data-focus-key="([^"]+)"/.exec(s);
    return fk && pageHtml().includes(`data-focus-key="${fk[1]}"`) ? { focus() { focused.push(fk[1]); } } : null;
  };
  doc.querySelectorAll = (s) => (s === 'button.dc-restore' ? fakeControls(page, /class="dc-restore link-btn" data-key="([^"]*)"/g, focused) : []);
  doc.activeElement = doc.body;
  // Select all, Delete: the list is empty and has no controls left, so focus goes to the At Risk card.
  page.run('selectAllLinked(true)');
  assert.deepEqual(focused.splice(0), ['linked-select-all']);
  page.run('deleteLinkedSelection()');
  assert.match(html(page), /No lines for this card/);
  assert.deepEqual(focused.splice(0), ['tile-late']);
  // Restore one line: focus the Restore button that took its place.
  const keys = fakeControls(page, /class="dc-restore link-btn" data-key="([^"]*)"/g, []).map((b) => b.dataset.key);
  assert.equal(keys.length, 3);
  page.run(`restoreDeletedLines(${JSON.stringify(keys[1])})`);
  assert.deepEqual(focused.splice(0), [keys[2]]);
  page.run(`restoreDeletedLines(${JSON.stringify(keys[2])})`);
  assert.deepEqual(focused.splice(0), [keys[0]]);
  // Restore all removes every Restore button; with nothing else to report Data check goes too, so the page's nav item.
  page.run('restoreDeletedLines()');
  assert.equal(atRiskCount(page), 3);
  assert.doesNotMatch(html(page), /data-focus-key="data-check"/);
  assert.deepEqual(focused.splice(0), ['nav-weekly']);
  // Apply Not At Risk to every line also empties the list.
  page.run('selectAllLinked(true)');
  focused.splice(0);
  page.run("linkedBulkStatus='Not At Risk';applyLinkedOverride()");
  assert.equal(atRiskCount(page), 0);
  assert.deepEqual(focused, ['tile-late']);
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
  };
  const desc = { reschedule: ['10', '55', '100', '9'] };
  for (const [col, order] of Object.entries(asc)) {
    page.run(`weeklyLineSort='col:${col}:asc';renderResults()`);
    assert.deepEqual(shownDocs(page), order, `${col} ascending`);
    assert.match(html(page), new RegExp(`<th(?: class="num")? aria-sort="ascending"><button type="button" class="th-sort" data-focus-key="linked-sort-${col}"`));
    page.run(`weeklyLineSort='col:${col}:desc';renderResults()`);
    assert.deepEqual(shownDocs(page), desc[col] || [...order].reverse(), `${col} descending`);
  }
  // Lead time has no column (the table fits a 1366px screen); it is in the delivery date's tip instead.
  page.run("weeklyLineSort='default';renderResults()");
  assert.doesNotMatch(html(page), /data-col="lead"|>Lead<|c-lead/);
  assert.match(html(page), /<td class="c-date" data-label="Original delivery"><span data-tip="Lead time 7\.1 wks \(order date to original delivery\)\.">2026-08-20<\/span><\/td>/);
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

test('Order Health, PO and Search lines fit the 1055px card of a 1366px screen and keep room for Item / Description', async () => {
  // Screen min-width of the table: the last plain (not print !important) rule that names it.
  const css = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  const cssMin = (cls) => Number([...css.matchAll(/([^{}]+)\{min-width:(\d+)px\}/g)].filter((m) => m[1].split(',').map((x) => x.trim()).includes(`.lines-table.${cls}`)).pop()[2]);
  const fixedCols = (h, cls) => [...h.match(new RegExp(`<table class="lines-table ${cls}">\\s*<colgroup>([\\s\\S]*?)</colgroup>`))[1].matchAll(/width:(\d+)px/g)].reduce((t, m) => t + Number(m[1]), 0);
  const heads = (h, cls) => [...h.match(new RegExp(`<table class="lines-table ${cls}">[\\s\\S]*?</thead>`))[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]*>/g, ''));
  const page = await atRiskPage([...pastDue(2), sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '700', CustomerVendorName: 'Acme Parts' })]);
  // Order Health: no Lead column; every other column (with Notes) is in the 1055px card at 1366.
  assert.deepEqual(heads(html(page), 'so'), ['', 'SO #', 'Customer', 'Warehouse', 'Item / Description', 'Original delivery', 'Open', 'Value', 'Status', 'Reschedule', 'Notes']);
  const so = cssMin('so') - fixedCols(html(page), 'so');
  page.run("setTab('purchaseorders')");
  const po = cssMin('po') - fixedCols(html(page), 'po');
  page.run("onGlobalSearchInput('Acme');applyGlobalSearch()");
  const search = cssMin('search') - fixedCols(html(page), 'search');
  for (const cls of ['so', 'po', 'search']) assert.ok(cssMin(cls) <= 1055, `${cls} table minimum ${cssMin(cls)}px`);
  assert.ok(so >= 130 && po >= 190 && search >= 140, `Item / Description gets ${so}px (SO), ${po}px (PO), ${search}px (Search) at the minimum width`);
  // Fixed layout: long customer and warehouse names stop at two lines (title has the full name) instead of widening rows.
  assert.match(HTML, /\.lines-table\{width:100%;border-collapse:collapse;table-layout:fixed;/);
  assert.match(HTML, /\.lines-table \.clip\{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;/);
  assert.match(html(page), /<td class="c-name" title="Acme Parts"><span class="clip"><mark>Acme<\/mark> Parts<\/span><\/td>/);
});

test('an override redraws Order Health without building other pages\' aggregates; delivery date math is worked out once', async () => {
  const delivery = (doc, closed) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, LineDueDate: '08/10/2026', DueDate: '08/10/2026', HeaderDueDate: '08/10/2026', OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: closed, CloseDateSource: 'Delivery', DeliveryDocNumber: `D${doc}`, OpenQuantity: '0' });
  // Early, on time, 1 and 2 days late (tolerance), 5 days late.
  const page = await atRiskPage([...pastDue(3), delivery('801', '08/08/2026'), delivery('802', '08/10/2026'), delivery('803', '08/11/2026'), delivery('804', '08/12/2026'), delivery('805', '08/15/2026')]);
  const otd = "(()=>{const s=otdStats(parsedRows.filter(isShipmentRow));return [s.scored,s.early,s.onTime,s.tolerance,s.late].map(x=>x.map(r=>r.documentNumber))})()";
  assert.deepEqual(page.run(otd), [['801', '802', '803', '804', '805'], ['801'], ['802'], ['803', '804'], ['805']]);
  page.run('var parses=0;var realParse=parseDate;parseDate=function(){parses++;return realParse.apply(this,arguments)}');
  assert.deepEqual(page.run(otd), [['801', '802', '803', '804', '805'], ['801'], ['802'], ['803', '804'], ['805']]);
  assert.equal(page.run('parses'), 0);
  page.run('parseDate=realParse');

  page.run("stgSet('hiddenPages',[])"); // 2v6.9: Warehouses is hidden by default; Settings > Hidden Pages brings it back
  const pages = { groupByMonth: 'monthly', groupByOriginalHeaderMonth: 'monthly', buildWarehouseKpis: 'warehouses', buildWarehouseTimeline: 'warehouses', buildMetricTimeline: 'metrics' };
  page.run(`var built={};${JSON.stringify([...Object.keys(pages), 'perfectOrderStats', 'backorderStats', 'buildRiskSummary', 'buildSupplyDemandSummary'])}.forEach(n=>{var f=globalThis[n];globalThis[n]=function(){built[n]=(built[n]||0)+1;return f.apply(this,arguments)};})`);
  page.run(`updateRowOverride(${JSON.stringify(keyOf(page, '1000'))},'status','Urgent')`);
  page.run('selectAllLinked(true);linkedBulkStatus="Hold";applyLinkedOverride()');
  assert.deepEqual(page.run('built'), {});
  // Each page builds what it shows on first view, once per metrics object, with the same numbers as before.
  for (const [fn, tab] of Object.entries(pages)) {
    page.run(`setTab('${tab}');renderResults()`);
    assert.equal(page.run(`built.${fn}`), 1, fn);
  }
  assert.equal(page.run('currentMetrics().perfectOrderRate'), page.run('perfectOrderStats(currentMetrics().allRows,indexShipmentsByLine(currentMetrics().allRows)).rate'));
  assert.equal(page.run('currentMetrics().backorderQty'), page.run('backorderStats(currentMetrics().allRows,indexShipmentsByLine(currentMetrics().allRows)).backorderQty'));
});

test('the guides promise row selection and header sort only on Order Health linked lines, where they exist', async () => {
  const page = await atRiskPage([...pastDue(1), sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '700' })]);
  assert.match(html(page), /class="row-check"[\s\S]*class="th-sort"/);
  page.run("setTab('purchaseorders')");
  const po = html(page).match(/<section[^>]*id="po-linked-lines"[\s\S]*?<\/section>/)[0];
  assert.match(po, /<td class="c-doc">700<\/td>/);
  assert.doesNotMatch(po, /row-check|th-sort/);
  for (const file of ['README.md', 'docs/USER_QUICK_START.md']) {
    const claim = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', file), 'utf8').split('\n').find((l) => /tick rows/.test(l));
    assert.match(claim, /Order Health/, file);
    assert.doesNotMatch(claim, /any linked-lines list/i, file);
  }
});

run();
