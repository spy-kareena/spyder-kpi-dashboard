// Build Risk / Clear To Build workbook tests. Run with `node tests/build-risk.test.js`.
// Fixtures are synthetic: a multi-sheet workbook built in the page's own SheetJS, shaped like the weekly
// "Orders at Risk" workbook (merged CM cells, blank spacer rows, Grand Total rows, a Lacombe section).
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const HEAD = ['CM ', 'Month', 'Total', 'Clear To Build', 'At Risk', 'Late', 'Closed', '% CTB', '% Late Orders'];
const _ = null; // an empty cell (merged CM cells and blank spacers have no cell at all)
const DIV = '#DIV/0!'; // written as an Excel error cell

// Newest week. The notes header is blank, as in the newest real sheets.
const SEP30 = { name: '0930 - Orders at Risk', merges: ['A2:A4', 'A6:A8', 'A10:A12'], aoa: [
  [...HEAD, _],
  ['DSM', 'September', 10, 8, 2, _, 0, '80%', '0%', 'Waiting on\nboards <script>'],
  [_, 'October', 6, 6, 0, _, 0, '100%', '0%', _],
  [_, 'TOTAL', 16, 14, 2, 0, 11, '88%', '0%', _],
  [],
  ['Price', 'September', 0, _, _, _, 0, DIV, DIV, _],
  [_, 'October', 28, 26, 2, _, 0, '93%', '0%', 'Two boards short'],
  [_, 'TOTAL', 28, 26, 2, 0, 0, '93%', '0%', _],
  [],
  ['Lacombe', 'July', _, _, _, _, _, _, _],
  [_, 'August', _, _, _, _, _, _, _],
  [_, 'TOTAL', _, _, _, _, _, _, _],
  [],
  ['Grand Total September', _, 10, 8, 2, 0, _, '80%', DIV],
  [],
  ['Grand Total October', _, 34, 32, 2, 0, _, '94%', '0%'],
  [],
  ['Lacombe', _, _, _, _, _, _, _, _],
  ['Firm Sales Orders', _, _, _, _, _, _, _, _],
  [_, 'September', 13, 9, 5, 4, _, '69%', '31%', 'Firm orders note'],
  [_, 'Total', 13, 9, 5, 4, _, '69%', '31%'],
] };
const SEP24 = { name: '0924 - Orders at Risk', merges: ['A2:A4'], aoa: [
  [...HEAD, 'NOTES'],
  ['DSM', 'September', 10, 5, 5, 0, 0, '50%', '0%', _],
  [_, 'October', 20, 10, 10, 0, 0, '50%', '0%', _],
  [_, 'TOTAL', 30, 15, 15, 0, 0, '50%', '0%', _],
] };
const CROSS_TAB = { name: 'May - Orders At Risk 57', aoa: [['Order Status\nMay', "CM's", _, _], ['Total', 'DSM', 'Price', 'IMS'], ['Late', 1, 2, 3]] };
const JUNK = { name: 'Sheet10', aoa: [[_, _, 'Job'], [_, _, 'DSM 1234']] };

// Builds an .xlsx in the page's SheetJS. "#DIV/0!" strings become real error cells.
function workbook(page, sheets) {
  return new Uint8Array(page.run(`(()=>{
    const wb=XLSX.utils.book_new();
    for(const s of ${JSON.stringify(sheets)}){
      const ws=XLSX.utils.aoa_to_sheet(s.aoa);
      Object.keys(ws).forEach(a=>{if(ws[a]&&ws[a].v==='#DIV/0!')ws[a]={t:'e',v:7};});
      if(s.merges)ws['!merges']=s.merges.map(r=>XLSX.utils.decode_range(r));
      XLSX.utils.book_append_sheet(wb,ws,s.name);
    }
    return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));
  })()`));
}
const due = (d) => ({ DueDate: d, HeaderDueDate: d, LineDueDate: d });
const KPI = sapExport([
  sapRow({ DocumentNumber: '71001', Warehouse: 'CM - DSM', ...due('09/15/2026') }),
  sapRow({ DocumentNumber: '71002', Warehouse: 'CM - Price', ...due('10/10/2026') }),
  sapRow({ DocumentNumber: '71003', Warehouse: 'Spyder - Lacombe', ...due('09/20/2026') }),
  sapRow({ DocumentNumber: '71004', Warehouse: 'Lacombe - Engineering', ...due('09/20/2026') }),
]);
async function loaded(sheets = [CROSS_TAB, SEP30, JUNK, SEP24], extra = []) {
  const page = loadPage();
  const wb = workbook(page, sheets);
  await upload(page, [{ name: 'kpi.xls', bytes: KPI }, { name: 'Orders At Risk - Clear to Build.xlsx', bytes: wb }, ...extra.map((n) => ({ name: n, bytes: wb }))]);
  return page;
}
const html = (page, setup = '') => { page.run(`${setup};stgSet("hiddenPages",[]);setTab("buildrisk")`); return page.els['results-screen'].innerHTML; };
// 2v2: the report's row count sits in the report-week bar (four cards per row); the other numbers are cards.
const stat = (h, label) => Number((h.match(label === 'CTB report lines' ? /<strong class="ctb-rows">([\d,]+)<\/strong> CTB report lines/ : new RegExp(`${label}</span><span class="kpi-value[^"]*">([\\d,]+)<`)) || [])[1]);

test('every weekly sheet is read and the newest week is shown by default; other sheets are ignored', async () => {
  const page = await loaded();
  assert.deepEqual(page.run('currentMetrics().buildRisk.snapshots.map(s=>[s.key,s.label,s.sheet])'),
    [['2026-09-30', 'Sep 30', '0930 - Orders at Risk'], ['2026-09-24', 'Sep 24', '0924 - Orders at Risk']]);
  assert.equal(page.run('buildRiskRows.filter(r=>/May|Sheet10/.test(r.snapshotSheet)).length'), 0);
  const h = html(page);
  assert.match(h, /<select id="build-risk-snapshot"[^>]*><option value="2026-09-30" selected>Sep 30<\/option><option value="2026-09-24">Sep 24<\/option>/);
  assert.match(h, /\(sheet 0930 - Orders at Risk\)\.">[\s\S]*?CTB report lines · 2 weeks loaded<\/span>/);
  // Sep 30 only: DSM 10+6, Price 0+28, Lacombe 13. The Sep 24 week is never added in.
  assert.equal(stat(h, 'Clear to build'), 8 + 6 + 26 + 9);
  assert.equal(stat(h, 'At risk'), 2 + 2 + 5);
  assert.equal(stat(h, 'Late'), 4);
  assert.equal(stat(h, 'CTB report lines'), 5);
  assert.doesNotMatch(h, /NaN|undefined/);
});

test('picking another report week changes every number and the risk-bucket orders', async () => {
  const page = await loaded();
  const before = html(page);
  assert.match(before, />71002</); // Price October is at risk on Sep 30
  const m = page.run('currentMetrics()===currentMetrics()');
  assert.equal(m, true);
  const h = html(page, 'setBuildRiskSnapshot("2026-09-24")');
  assert.match(h, /<option value="2026-09-24" selected>/);
  assert.equal(stat(h, 'Clear to build'), 15);
  assert.equal(stat(h, 'At risk'), 15);
  assert.equal(stat(h, 'CTB report lines'), 2);
  assert.doesNotMatch(h, />71002</); // Price is not in the Sep 24 report
  assert.match(h, />71001</); // DSM September is at risk on Sep 24
  // A week that is no longer loaded falls back to the newest one.
  assert.equal(stat(html(page, 'setBuildRiskSnapshot("2025-01-01")'), 'Clear to build'), 49);
});

test('merged CM cells, Grand Total rows, stale blocks and the Lacombe / Firm Sales Orders section', async () => {
  const page = await loaded();
  const rows = page.run('buildRiskRows.filter(r=>r.snapshot==="2026-09-30").map(r=>[r.cm,r.cmKey,r.month,r.monthKey,r.isTotal,r.total,r.clearToBuild,r.atRisk,r.late,r.closed,r.ctbPercent])');
  assert.deepEqual(rows, [
    ['DSM', 'DSM', 'September', '2026-09', false, 10, 8, 2, 0, 0, '80%'],
    ['DSM', 'DSM', 'October', '2026-10', false, 6, 6, 0, 0, 0, '100%'],
    ['DSM', 'DSM', 'TOTAL', '', true, 16, 14, 2, 0, 11, '88%'],
    ['Price', 'Price', 'September', '2026-09', false, 0, 0, 0, 0, 0, ''], // "#DIV/0!" reads as blank
    ['Price', 'Price', 'October', '2026-10', false, 28, 26, 2, 0, 0, '93%'],
    ['Price', 'Price', 'TOTAL', '', true, 28, 26, 2, 0, 0, '93%'],
    ['Lacombe', 'Lacombe', 'September', '2026-09', false, 13, 9, 5, 4, 0, '69%'],
    ['Lacombe', 'Lacombe', 'Total', '', true, 13, 9, 5, 4, 0, '69%'],
  ]);
  // The Lacombe block is shown but matched to no sales order lines (it covers only a few firm orders).
  const lac = page.run('currentMetrics().buildRisk.snapshots[0].matched.find(r=>r.cm==="Lacombe").matchedRows.map(r=>r.documentNumber)');
  assert.deepEqual(lac, []);
  // ... and "About these numbers" says so.
  const h = html(page);
  assert.match(h, /Lacombe firm orders are for reference only \(not matched\)/);
  assert.doesNotMatch(h, /matched to the Spyder - Lacombe warehouse/);
});

test('risk-bucket orders: the override as text with its cause, one Edit button opens the note editor, an Amount column', async () => {
  const page = await loaded();
  const table = () => { const h = html(page); return h.slice(h.indexOf('Sales orders in risk buckets') - 200); };
  let t = table();
  assert.match(t, /<section class="table editable-rows">[\s\S]*?<table class="data-table cards" style="min-width:960px"/);
  const heads = [...t.match(/<thead>[\s\S]*?<\/thead>/)[0].matchAll(/<th\b[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Doc #', 'Customer / vendor', 'Effective due', 'Warehouse', 'Item', 'Qty open', 'Amount', 'Status', 'Override', '']);
  // No dropdowns or note boxes in the rows: the override reads as text and the editor opens on Edit.
  assert.doesNotMatch(t.split('</table>')[0], /<select|<textarea/);
  // Phone cards: every cell carries its column name and card place (doc # and amount on top, status line, override).
  let row = t.match(/<tr class="">\s*<td class="strong" data-label="Doc #" data-card="key">71001<\/td>[\s\S]*?<\/tr>/)[0];
  assert.match(row, /<td class="date due-cell soft" data-label="Effective due">2026-09-15<span class="sub [a-z-]+">Due in [^<]+<\/span><\/td>/, 'due timing under the date');
  assert.match(row, /<td class="num strong" data-label="Amount" data-card="amt">\$1,000<\/td>/, 'the amount');
  assert.match(row, /<td data-label="Status" data-card="st"><span class="pill /);
  assert.match(row, /<td class="ovr-cell" data-label="Override" data-card="edit"><span class="ovr-line"><span class="muted">—<\/span><\/span><\/td>/);
  assert.match(row, /<td class="c-edit print-hide" data-card="edit"><button type="button" class="note-btn" data-key="[^"]+" onclick="toggleRowNote\(this\.dataset\.key\)" aria-expanded="false" aria-label="Edit override, cause and note for 71001" data-tip="[^"]+">Edit<\/button><\/td>/);
  // Edit opens the shared editor row under the line (Override, Cause, Note, Done), as on Purchase Orders.
  const key = JSON.stringify(page.run("rowKey(parsedRows.find(r=>r.documentNumber==='71001'))"));
  page.run(`toggleRowNote(${key})`);
  t = table();
  assert.match(t, /aria-expanded="true"[^>]*>Edit<\/button><\/td>\s*<\/tr><tr class="note-editor-row print-hide"><td colspan="10">[\s\S]*?<select class="row-override"[\s\S]*?<select class="row-cause"[\s\S]*?<textarea class="row-note"[\s\S]*?>Done<\/button>/);
  // What was saved shows as text in the row (and on paper) in the owner's words; the button stays one short Edit.
  page.run(`updateRowOverride(${key},'status','Supplier Late');updateRowOverride(${key},'cause','us');updateRowOverride(${key},'notes','Boards <Friday>');toggleRowNote(${key})`);
  t = table();
  assert.doesNotMatch(t, /note-editor-row/);
  row = t.match(/<tr class="">\s*<td class="strong" data-label="Doc #" data-card="key">71001<\/td>[\s\S]*?<\/tr>/)[0];
  assert.match(row, /<td class="ovr-cell" data-label="Override" data-card="edit"><span class="ovr-line"><span class="ovr-text">Supplier Delay<\/span><span class="cause-tag us">Us<\/span><\/span><span class="ovr-note" title="Boards &lt;Friday&gt;">Boards &lt;Friday&gt;<\/span><\/td>/);
  assert.doesNotMatch(row, />Supplier Late</);
  assert.match(row, /class="note-btn has-note"[^>]*data-tip="Override: Supplier Delay\.\nNote: Boards &lt;Friday&gt;"[^>]*>Edit<\/button>/);
  assert.equal(page.run(`parsedRows.find(r=>r.documentNumber==='71001').overrideStatus`), 'Supplier Late', 'the stored value keeps the original words');
  // The bucket legend's Clear is green, like the Clear bars (blue is not a status colour here).
  const h = html(page);
  assert.match(h, /<span><i class="sw" style="background:var\(--good\)"><\/i>Clear<\/span>/);
  assert.doesNotMatch(h, /var\(--accent\)"><\/i>Clear/);
  // Screen widths for the editor's controls and the due cell stay; print hides the editor.
  assert.match(HTML, /@media screen\{\.editable-rows \.row-override\{min-width:140px\}\.editable-rows \.row-note\{min-width:200px\}\.editable-rows \.due-cell\{white-space:nowrap\}\}/);
  assert.deepEqual(page.errors, []);
});

test('the blank notes header is read as Notes; notes keep their line breaks and are escaped', async () => {
  const page = await loaded();
  const h = html(page);
  assert.match(h, /Waiting on<br>boards &lt;script&gt;/);
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /Firm orders note/);
});

test('CTB % by CM trend: one row per CM, weeks oldest to newest, tone and tooltip', async () => {
  const page = await loaded();
  const h = html(page);
  const card = h.slice(h.indexOf('CTB % by CM'));
  assert.match(card, /<th class="num">Sep 24<\/th><th class="num">Sep 30<\/th>/);
  assert.match(card, /<td class="m">DSM<\/td><td class="num"><span class="pill bad" title="15 of 30 clear to build · 15 at risk · 0 late">50%<\/span><\/td><td class="num"><span class="pill warn" title="14 of 16 clear to build · 2 at risk · 0 late">88%<\/span>/);
  assert.match(card, /<td class="m">Price<\/td><td class="num muted">—<\/td><td class="num"><span class="pill good"[^>]*>93%</);
});

test('sheet names give the report week; the year comes from today and months take the nearest year', async () => {
  const page = loadPage({ today: '2026-01-20' });
  const sheet = (name, months) => ({ name, aoa: [HEAD, ...months.map((m) => [m === months[0] ? 'IMS' : _, m, 4, 3, 1, 0, 0, '75%', '0%'])] });
  const wb = workbook(page, [sheet('0115 - Orders at Risk', ['December', 'January']), sheet('1230 - Orders at Risk', ['December']),
    sheet('June - Orders At Risk 62', ['June']), sheet('716 - Orders at Risk', ['July'])]);
  await upload(page, [{ name: 'ctb.xlsx', bytes: wb }]);
  assert.deepEqual(page.run('buildRiskRows.map(r=>[r.snapshot,r.monthKey])'), [
    ['2026-01-15', '2025-12'], ['2026-01-15', '2026-01'], ['2025-12-30', '2025-12'], ['2025-06-02', '2025-06'], ['2025-07-16', '2025-07'],
  ]);
});

test('year-less months in a CSV report take the year nearest the as-of date', async () => {
  const page = loadPage({ today: '2027-01-06' });
  const kpi = sapExport(['12/20/2026', '01/20/2027'].map((d, i) => sapRow({ ExportDate: '01/05/2027', DocumentNumber: `8100${i + 1}`, Warehouse: 'CM - DSM', ...due(d) })));
  const csv = new Uint8Array(Buffer.from('CM,Month,Total,Clear To Build,At Risk,Late\r\nDSM,December,5,3,2,0\r\n,January,10,8,2,0\r\n'));
  await upload(page, [{ name: 'kpi.xls', bytes: kpi }, { name: 'ctb.csv', bytes: csv }]);
  assert.deepEqual(page.run('currentMetrics().buildRisk.snapshots[0].matched.map(r=>[r.monthKey,r.matchedRows.map(m=>m.documentNumber)])'),
    [['2026-12', ['81001']], ['2027-01', ['81002']]]);
});

test('an export older than the workbook does not push the newest weeks back a year', async () => {
  const sheet = (name, months) => ({ name, aoa: [HEAD, ...months.map((m) => [m === months[0] ? 'DSM' : _, m, 4, 3, 1, 0, 0, '75%', '0%'])] });
  const kpi = (exportDate, dueDate) => sapExport([sapRow({ ExportDate: exportDate, DocumentNumber: '81001', Warehouse: 'CM - DSM', ...due(dueDate) })]);
  // A July export next to a workbook written through September.
  const july = loadPage({ today: '2026-10-01' });
  await upload(july, [{ name: 'kpi.xls', bytes: kpi('07/15/2026', '09/20/2026') },
    { name: 'ctb.xlsx', bytes: workbook(july, [sheet('0930 - Orders at Risk', ['September']), sheet('0908 - Orders at Risk', ['September']), sheet('0521 - Orders at Risk', ['May'])]) }]);
  assert.deepEqual(july.run('currentMetrics().buildRisk.snapshots.map(s=>s.key)'), ['2026-09-30', '2026-09-08', '2026-05-21']);
  assert.match(html(july), /<option value="2026-09-30" selected>/);
  // A late-December export next to a January sheet: the January week is the newest, and its months are next year.
  const jan = loadPage({ today: '2027-01-10' });
  await upload(jan, [{ name: 'kpi.xls', bytes: kpi('12/28/2026', '01/20/2027') },
    { name: 'ctb.xlsx', bytes: workbook(jan, [sheet('0106 - Orders at Risk', ['January', 'February']), sheet('1230 - Orders at Risk', ['January'])]) }]);
  assert.deepEqual(jan.run('currentMetrics().buildRisk.snapshots.map(s=>[s.key,s.matched.map(r=>[r.monthKey,r.matchedRows.length])])'), [
    ['2027-01-06', [['2027-01', 1], ['2027-02', 0]]], ['2026-12-30', [['2027-01', 1]]],
  ]);
});

test('the same workbook loaded twice is not double counted', async () => {
  const once = (await loaded()).run('buildRiskRows.length');
  const twice = await loaded(undefined, ['copy.xlsx']);
  assert.equal(twice.run('buildRiskRows.length'), once);
  assert.equal(stat(html(twice), 'Clear to build'), 49);
  // A one-sheet workbook twice: the repeated sheet arrives right after itself.
  const single = await loaded([SEP30], ['copy.xlsx']);
  assert.equal(single.run('buildRiskRows.length'), 8);
});

// Add file, awaited: the page re-reads every loaded file plus the new ones, as addFiles does.
async function addFile(page, files) { page.ctx.__added = files; await page.run('handleFiles([...loadedFiles,...__added],{adding:true})'); }
const dsmWeek = (week, ctb, note) => ({ name: `${week} - Orders at Risk`, aoa: [[...HEAD, 'Notes'], ['DSM', 'September', 10, ctb, 10 - ctb, 0, 0, '', '', note]] });

test('an updated workbook added later replaces the weeks it repeats', async () => {
  const page = loadPage({ today: '2026-10-08' });
  const v1 = workbook(page, [dsmWeek('0930', 5, 'old')]);
  const v2 = workbook(page, [dsmWeek('1007', 7, 'new week'), dsmWeek('0930', 9, 'corrected')]);
  await upload(page, [{ name: 'kpi.xls', bytes: KPI }, { name: 'ctb-v1.xlsx', bytes: v1 }]);
  await addFile(page, [{ name: 'ctb-v2.xlsx', bytes: v2 }]);
  const weeks = 'buildRiskRows.map(r=>[r.snapshot,r.clearToBuild,r.notes]).sort()';
  assert.deepEqual(page.run(weeks), [['2026-09-30', 9, 'corrected'], ['2026-10-07', 7, 'new week']]);
  // Adding the older workbook again makes it the newest file: the file added last wins.
  await addFile(page, [{ name: 'ctb-v1 (1).xlsx', bytes: v1 }]);
  assert.deepEqual(page.run(weeks), [['2026-09-30', 5, 'old'], ['2026-10-07', 7, 'new week']]);
});

test('undated CTB data loaded twice (CSV, or a sheet named without a date) is counted once and reported', async () => {
  const csv = new Uint8Array(Buffer.from('CM,Month,Total,Clear To Build,At Risk,Late\r\nDSM,Sep 2026,7,5,2,0\r\n,Oct 2026,8,6,2,0\r\n'));
  const note = /Ignored 2 rows that were already in another uploaded file/;
  const dq = (page) => page.run('dataQualityIssues.map(i=>i.message)').join(' ');
  const added = loadPage();
  await upload(added, [{ name: 'kpi.xls', bytes: KPI }, { name: 'ctb.csv', bytes: csv }]);
  await addFile(added, [{ name: 'ctb.csv', bytes: csv }]);
  const together = loadPage();
  await upload(together, [{ name: 'kpi.xls', bytes: KPI }, { name: 'ctb.csv', bytes: csv }, { name: 'ctb (1).csv', bytes: csv }]);
  const sheets = loadPage();
  const wb = workbook(sheets, [{ name: 'Sheet1', aoa: [HEAD, ['DSM', 'Sep 2026', 7, 5, 2, 0], [_, 'Oct 2026', 8, 6, 2, 0]] }]);
  await upload(sheets, [{ name: 'kpi.xls', bytes: KPI }, { name: 'a.xlsx', bytes: wb }, { name: 'b.xlsx', bytes: wb }]);
  for (const page of [added, together, sheets]) {
    const h = html(page);
    assert.equal(stat(h, 'CTB report lines'), 2);
    assert.equal(stat(h, 'Clear to build'), 11);
    assert.equal(stat(h, 'At risk'), 4);
    assert.match(dq(page), note);
  }
  // Two different undated reports are both kept, and the same dated workbook twice is now reported too.
  const other = new Uint8Array(Buffer.from('CM,Month,Total,Clear To Build,At Risk,Late\r\nIMS,Sep 2026,4,4,0,0\r\n'));
  const both = loadPage();
  await upload(both, [{ name: 'kpi.xls', bytes: KPI }, { name: 'ctb.csv', bytes: csv }, { name: 'ims.csv', bytes: other }]);
  assert.equal(stat(html(both), 'Clear to build'), 15);
  assert.doesNotMatch(dq(both), /Ignored/);
  assert.match(dq(await loaded(undefined, ['copy.xlsx'])), /Ignored 11 rows that were already in another uploaded file/);
});

test('a single CTB report as CSV still works: no week picker, and it is a separate pick next to a workbook', async () => {
  const csv = new Uint8Array(Buffer.from('CM,Month,Total,Clear To Build,At Risk,Late,Notes\r\nIMS,Sep 2026,5,4,1,0,"a\nb"\r\n,Oct 2026,,,,,\r\n'));
  const page = loadPage();
  await upload(page, [{ name: 'kpi.xls', bytes: KPI }, { name: 'ctb.csv', bytes: csv }]);
  const h = html(page);
  assert.doesNotMatch(h, /build-risk-snapshot|CTB % by CM/);
  assert.equal(stat(h, 'Clear to build'), 4);
  assert.match(h, /a<br>b/);
  const mixed = loadPage();
  await upload(mixed, [{ name: 'kpi.xls', bytes: KPI }, { name: 'ctb.xlsx', bytes: workbook(mixed, [SEP30]) }, { name: 'ctb.csv', bytes: csv }]);
  assert.match(html(mixed), /<option value="2026-09-30" selected>Sep 30<\/option><option value="undated">Undated report<\/option>/);
  assert.equal(stat(html(mixed, 'setBuildRiskSnapshot("undated")'), 'Clear to build'), 4);
});

test('the workbook alone works, sheet names are escaped, and a share snapshot keeps every week', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'ctb.xlsx', bytes: workbook(page, [{ ...SEP30, name: '0930 <img src=x onerror=x>' }, SEP24]) }]);
  const h = html(page);
  assert.match(h, /<option value="2026-09-30" selected>/);
  assert.match(h, /\(sheet 0930 &lt;img src=x onerror=x&gt;\)\.">[\s\S]*?CTB report lines · 2 weeks loaded<\/span>/);
  assert.doesNotMatch(h, /<img|NaN|undefined/);
  assert.match(h, /No open sales orders fall in CM \/ month buckets/);
  // A share snapshot carries the normalized rows (report week included) and is read back as-is.
  const shared = loadPage();
  shared.run(`isSnapshotView=true;buildRiskRows=JSON.parse(${JSON.stringify(page.run('JSON.stringify(buildRiskRows)'))});invalidateMetrics();showResults()`);
  assert.equal(stat(html(shared), 'Clear to build'), 49);
  assert.equal(stat(html(shared, 'setBuildRiskSnapshot("2026-09-24")'), 'Clear to build'), 15);
});

test('CM names in the report map to their warehouses', () => {
  const page = loadPage();
  const map = page.run(`["DSM","August","Price","IMS","Logican","Dorigo","Lacombe","Spyder - Lacombe","Lacombe - Engineering","Intransit - Lacombe/McBride","CM SFG - August Electronics","CM - Logican"].map(cmKey)`);
  assert.deepEqual(map, ['DSM', 'August Electronics', 'Price', 'IMS', 'Logican', 'Dorigo', 'Lacombe', '', '', '', 'August Electronics', 'Logican']);
});

run();
