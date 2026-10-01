// Build Risk / Clear To Build workbook tests. Run with `node tests/build-risk.test.js`.
// Fixtures are synthetic: a multi-sheet workbook built in the page's own SheetJS, shaped like the weekly
// "Orders at Risk" workbook (merged CM cells, blank spacer rows, Grand Total rows, a Lacombe section).
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
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
const html = (page, setup = '') => { page.run(`${setup};setTab("buildrisk")`); return page.els['results-screen'].innerHTML; };
const stat = (h, label) => Number((h.match(new RegExp(`${label}</span><span class="kpi-value[^"]*">([\\d,]+)<`)) || [])[1]);

test('every weekly sheet is read and the newest week is shown by default; other sheets are ignored', async () => {
  const page = await loaded();
  assert.deepEqual(page.run('currentMetrics().buildRisk.snapshots.map(s=>[s.key,s.label,s.sheet])'),
    [['2026-09-30', 'Sep 30', '0930 - Orders at Risk'], ['2026-09-24', 'Sep 24', '0924 - Orders at Risk']]);
  assert.equal(page.run('buildRiskRows.filter(r=>/May|Sheet10/.test(r.snapshotSheet)).length'), 0);
  const h = html(page);
  assert.match(h, /<select id="build-risk-snapshot"[^>]*><option value="2026-09-30" selected>Sep 30<\/option><option value="2026-09-24">Sep 24<\/option>/);
  // Sep 30 only: DSM 10+6, Price 0+28, Lacombe 13. The Sep 24 week is never added in.
  assert.equal(stat(h, 'Clear to build'), 8 + 6 + 26 + 9);
  assert.equal(stat(h, 'At risk'), 2 + 2 + 5);
  assert.equal(stat(h, 'Late'), 4);
  assert.equal(stat(h, 'CTB report rows'), 5);
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
  assert.equal(stat(h, 'CTB report rows'), 2);
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
  // Lacombe firm sales orders match Spyder - Lacombe lines only, not the other Lacombe warehouses.
  const lac = page.run('currentMetrics().buildRisk.snapshots[0].matched.find(r=>r.cm==="Lacombe").matchedRows.map(r=>r.documentNumber)');
  assert.deepEqual(lac, ['71003']);
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

test('sheet names give the report week; the year comes from the report date and months take the nearest year', async () => {
  const page = loadPage({ today: '2026-01-20' });
  const sheet = (name, months) => ({ name, aoa: [HEAD, ...months.map((m) => [m === months[0] ? 'IMS' : _, m, 4, 3, 1, 0, 0, '75%', '0%'])] });
  const wb = workbook(page, [sheet('0115 - Orders at Risk', ['December', 'January']), sheet('1230 - Orders at Risk', ['December']),
    sheet('June - Orders At Risk 62', ['June']), sheet('716 - Orders at Risk', ['July'])]);
  await upload(page, [{ name: 'ctb.xlsx', bytes: wb }]);
  assert.deepEqual(page.run('buildRiskRows.map(r=>[r.snapshot,r.monthKey])'), [
    ['2026-01-15', '2025-12'], ['2026-01-15', '2026-01'], ['2025-12-30', '2025-12'], ['2025-06-02', '2025-06'], ['2025-07-16', '2025-07'],
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

test('CM names in the report map to their warehouses', () => {
  const page = loadPage();
  const map = page.run(`["DSM","August","Price","IMS","Logican","Dorigo","Lacombe","Spyder - Lacombe","Lacombe - Engineering","Intransit - Lacombe/McBride","CM SFG - August Electronics","CM - Logican"].map(cmKey)`);
  assert.deepEqual(map, ['DSM', 'August Electronics', 'Price', 'IMS', 'Logican', 'Dorigo', 'Lacombe', 'Lacombe', '', '', 'August Electronics', 'Logican']);
});

run();
