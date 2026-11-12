// Live SAP data types (2v6.8): what the SAP bridge serves (hana.to_tsv: UTF-8, tab separated, CRLF, a header row,
// dates YYYY-MM-DD, date-times "YYYY-MM-DD HH:MM:SS", plain decimals, floats as Python repr such as 1e-05, empty cells
// for NULL, text with tabs and line breaks made spaces) must give the same report as a Query Manager export of the same
// lines (UTF-16 with BOM, MM/DD/YYYY dates, numbers with thousands separators), on every page.
// tests/fixtures/kpi_from_bridge.txt is the bridge repo's own fixture (synthetic). Run: node tests/bridge-data.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createSuite } = require('./harness');

const { test, run } = createSuite();
const ORIGIN = 'https://kpi.example.test';
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'kpi_from_bridge.txt'), 'utf8');
const HEAD = FIXTURE.split('\r\n')[0].split('\t');

// Edge values, as the bridge writes them.
const EDGE = [
  // Date-times with a time part, a decimal amount, a negative amount, a float written as 1e-05, empty cells.
  { ExportDate: '2026-09-10 08:15:42', SourceType: 'Sales Order', DocEntry: '1101', DocumentNumber: '45101', LineNumber: '1', CustomerPONumber: '',
    DocumentDate: '2026-07-03 14:30:00', DueDate: '2026-08-25 09:00:00', HeaderDueDate: '2026-08-25', LineDueDate: '2026-08-25 23:59:59',
    CustomerVendorCode: 'CAFE', CustomerVendorName: 'Café "Ünïcode" & <Sons>; O\'Neil, Ltd.', GroupCode: '102', CustomerVendorGroup: 'RV', DocumentOwner: 'Zoë Ng',
    OrderType: 'Sales Order', Department: '', Project: '', ItemCode: 'SPY-ÆØ', ItemDescription: '"Quoted" board, 3/4" × 2½ — 100%', ItemGroupName: 'Electronics',
    Warehouse: 'Spyder - Lacombe', Quantity: '2.5', OpenQuantity: '1e-05', AmountLocal: '1234.5', AmountForeign: '-0.0', Currency: 'CAD', Status: 'Open',
    DaysPastDue: '30', KpiStatus: 'Late', LineRescheduleDate: '', RescheduleDate: '', RescheduleFlag: 'Open', DueDateRiskFlag: 'Late', Confirmed: 'Y', FillStatus: 'Partial' },
  // A credit-like line: negative quantities and amounts, a large float in repr form, a no-commit date-time.
  { ExportDate: '2026-09-10', SourceType: 'Sales Order', DocEntry: '1102', DocumentNumber: '45102', LineNumber: '0', CustomerPONumber: 'PO#7	x'.replace('\t', ' '),
    DocumentDate: '2026-08-01', DueDate: '2026-09-30', HeaderDueDate: '2026-09-30', LineDueDate: '2026-09-30',
    CustomerVendorCode: 'NEG', CustomerVendorName: 'Return Co', GroupCode: '104', CustomerVendorGroup: 'Marine', DocumentOwner: 'Alex Rivera',
    OrderType: 'Sales Order', Department: 'Production', Project: 'P-9', ItemCode: 'SPY-900', ItemDescription: 'Credit line', ItemGroupName: 'Wiring',
    Warehouse: 'Spyder - McBride', Quantity: '-3', OpenQuantity: '-3', AmountLocal: '-250.75', AmountForeign: '1.5e+16', Currency: 'CAD', Status: 'Open',
    DaysPastDue: '-20', KpiStatus: 'No Commit', LineRescheduleDate: '1111-11-11 00:00:00', RescheduleDate: '1111-11-11', RescheduleFlag: 'No Commit', DueDateRiskFlag: 'No Commit', Confirmed: 'N', FillStatus: 'Not Shipped/Received' },
  // A purchase order line with a float line total and a closed receipt date-time.
  { ExportDate: '2026-09-10', SourceType: 'Purchase Order', DocEntry: '2101', DocumentNumber: '88101', LineNumber: '2', CustomerPONumber: '',
    DocumentDate: '2026-06-01', ClosedDate: '2026-09-02 16:05:00', CloseDateSource: 'Receipt', DeliveryDocNumber: '5501', DueDate: '2026-08-30', HeaderDueDate: '2026-08-30', LineDueDate: '2026-08-30',
    CustomerVendorCode: 'TTI', CustomerVendorName: 'TTI Inc', GroupCode: '', CustomerVendorGroup: 'Supplier', DocumentOwner: 'Pat Morgan',
    OrderType: 'PO Receipt', Department: 'Purchasing', Project: '', ItemCode: 'CONN-10', ItemDescription: 'Connector', ItemGroupName: 'Components',
    Warehouse: 'CM - DSM', Quantity: '12.0', OpenQuantity: '0', AmountLocal: '0.1', AmountForeign: '', Currency: 'USD', Status: 'Closed',
    DaysPastDue: '', KpiStatus: 'Closed', LineRescheduleDate: '', RescheduleDate: '', RescheduleFlag: 'Closed', DueDateRiskFlag: '', Confirmed: 'Y', FillStatus: 'Complete' },
];
const bridgeText = FIXTURE + EDGE.map((r) => HEAD.map((h) => r[h] ?? '').join('\t')).join('\r\n') + '\r\n';

// The same lines as a Query Manager "Export to Excel" writes them.
function queryManager(text) {
  const lines = text.trim().split('\r\n').map((l) => l.split('\t'));
  const numeric = new Set(['Quantity', 'OpenQuantity', 'AmountLocal', 'AmountForeign', 'DaysPastDue']);
  const out = lines.map((cells, i) => (i === 0 ? cells : cells.map((v, c) => {
    const h = lines[0][c];
    const d = v.match(/^(\d{4})-(\d{2})-(\d{2})(?: \d{2}:\d{2}:\d{2})?$/);
    if (d) return `${d[2]}/${d[3]}/${d[1]}`;
    if (numeric.has(h) && v !== '') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 10 }).replace(/^-0$/, '0');
    return v;
  })));
  const tsv = out.map((c) => c.join('\t')).join('\r\n') + '\r\n';
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tsv, 'utf16le')]));
}

// A hosted page whose /api/sap/* answers with the bridge's text (and its headers).
async function livePage(kpiText, sdText) {
  const page = loadPage();
  await tick();
  const calls = [];
  const answer = (body, name) => new Response(body, { status: 200, headers: { 'content-type': 'text/tab-separated-values; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'x-refreshed-at': '2026-09-10T08:15:42-06:00', 'x-row-count': '9' } });
  Object.assign(page.ctx, {
    Blob, File, Response, location: { href: ORIGIN + '/', protocol: 'https:' },
    fetch: async (url) => {
      const u = String(url);
      calls.push(u);
      if (u === '/api/sap/status') return new Response('{"configured":true}', { headers: { 'content-type': 'application/json' } });
      if (u.startsWith('/api/sap/kpi')) return answer(kpiText, 'SAP_live_KPI_2026-09-10.txt');
      if (u.startsWith('/api/sap/supply-demand')) return sdText ? answer(sdText, 'SAP_live_supply_demand_2026-09-10.txt') : new Response('{"error":"no"}', { status: 502 });
      return new Response('', { status: 404 });
    },
    FileReader: class {
      readAsArrayBuffer(f) { (ArrayBuffer.isView(f.bytes) ? Promise.resolve(f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength)) : f.arrayBuffer()).then((b) => this.onload({ target: { result: b } })); }
      readAsText(f) { (ArrayBuffer.isView(f.bytes) ? Promise.resolve(Buffer.from(f.bytes).toString('utf8')) : f.text()).then((t) => this.onload({ target: { result: t } })); }
    },
  });
  page.run('isSnapshotView=false');
  await page.ctx.liveStart();
  await settle();
  page.calls = calls;
  return page;
}
async function importPage(files) {
  const page = loadPage({ storage: { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) } });
  await tick();
  page.run('isSnapshotView=false');
  await page.ctx.handleFiles(files);
  await settle();
  return page;
}
const ROWS = 'JSON.stringify(allLoadedRows.map(r=>({k:r.rowKey,src:r.sourceType,doc:r.documentNumber,line:r.lineNumber,item:r.itemCode,desc:r.itemDescription,name:r.name,owner:r.owner,po:r.customerPONumber,qty:r.quantity,open:r.openQuantity,amt:r.amountLocal,amtF:r.amountForeign,due:+parseDate(r.dueDate),eff:r.effectiveDueDate?+parseDate(r.effectiveDueDate):null,close:r.closeDate?+parseDate(r.closeDate):null,doc0:+parseDate(r.documentDate),st:r.statusBucket,nc:r.noCommitDate,late:r.isLate,pd:r.isPastDue,bad:r.invalidDates||null})).sort((a,b)=>a.k<b.k?-1:1))';

test('the bridge fixture and every edge value load through Live SAP with the same lines and values as a Query Manager export', async () => {
  const live = await livePage(bridgeText);
  assert.equal(live.run('liveState.status'), 'ok');
  assert.equal(live.run('allLoadedRows.length'), 8);
  assert.deepEqual(live.run('dataQualityIssues'), [], 'no unreadable dates or files');
  const qm = await importPage([{ name: 'export.xls', bytes: queryManager(bridgeText) }]);
  assert.equal(qm.run('allLoadedRows.length'), 8);
  assert.equal(live.run(ROWS), qm.run(ROWS));
  assert.equal(live.run('displayDate(reportAsOfDate)'), '2026-09-10', 'the export date ignores the time part');

  const byDoc = (doc) => live.run(`(()=>{const r=allLoadedRows.find(x=>x.documentNumber===${JSON.stringify(doc)}&&!x.deliveryDocNumber);return {qty:r.quantity,open:r.openQuantity,amt:r.amountLocal,amtF:r.amountForeign,name:r.name,desc:r.itemDescription,due:displayDate(r.dueDate),doc:displayDate(r.documentDate),st:r.statusBucket,nc:r.noCommitDate,po:r.customerPONumber}})()`);
  assert.deepEqual(byDoc('45101'), { qty: 2.5, open: 0.00001, amt: 1234.5, amtF: 0, name: 'Café "Ünïcode" & <Sons>; O\'Neil, Ltd.', desc: '"Quoted" board, 3/4" × 2½ — 100%', due: '2026-08-25', doc: '2026-07-03', st: 'Past Due', nc: false, po: '' });
  assert.equal(live.run('Object.is(allLoadedRows.find(x=>x.documentNumber==="45101").amountForeign,0)'), true, '-0.0 reads as 0, not -0');
  assert.deepEqual(byDoc('45102'), { qty: -3, open: -3, amt: -250.75, amtF: 1.5e16, name: 'Return Co', desc: 'Credit line', due: '2026-09-30', doc: '2026-08-01', st: 'No Commit', nc: true, po: 'PO#7 x' });
  const receipt = live.run('(()=>{const r=allLoadedRows.find(x=>x.deliveryDocNumber==="5501");return {close:displayDate(r.closeDate),qty:r.quantity,amt:r.amountLocal,st:r.statusBucket}})()');
  assert.deepEqual(receipt, { close: '2026-09-02', qty: 12, amt: 0.1, st: 'Closed' });
});

test('every page shows the same report from the bridge as from the Query Manager export, with no broken values', async () => {
  const live = await livePage(bridgeText);
  const qm = await importPage([{ name: 'export.xls', bytes: queryManager(bridgeText) }]);
  for (const tab of ['weekly', 'purchaseorders', 'supplyweekly', 'monthly', 'warehouses', 'metrics', 'supplydemand', 'buildrisk', 'search']) {
    const html = (page) => { page.run(`searchQuery=${tab === 'search' ? "'Café'" : "''"};setTab(${JSON.stringify(tab)})`); return page.els['results-screen'].innerHTML; };
    const a = html(live), b = html(qm);
    const text = a.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]|Infinity|-\$0\b|\b-0\b/, `tab ${tab}`);
    assert.ok(!/<Sons>/.test(a), `tab ${tab}: text from SAP is escaped`);
    assert.equal(a, b, `tab ${tab} differs`);
  }
});

test('supply / demand from the bridge: negative net quantities, decimals, YYYY-MM months and empty cells', async () => {
  const head = ['ExportDate', 'ItemCode', 'ItemDescription', 'ItemGroupName', 'WarehouseCode', 'WarehouseName', 'MonthStart', 'YearMonth', 'DemandOpenQty', 'DemandNoCommitQty', 'DemandOpenValue', 'UsableSupplyQty', 'RescheduledSupplyQty', 'UnconfirmedSupplyQty', 'NoCommitSupplyQty', 'LateSupplyQty', 'RiskSupplyQty', 'DemandOrderCount', 'MonthlyNetQty', 'CumulativeNetQty', 'MonthlyCoverageStatus', 'CumulativeCoverageStatus', 'SupplyRiskFlag'];
  const rows = [
    ['2026-09-10', 'SPY-100', 'Controller board', 'Electronics', '01', 'Spyder - Lacombe', '2026-09-01', '2026-09', '10', '0', '12500.5', '4.25', '0', '0', '0', '0', '0', '2', '-5.75', '-5.75', 'Short', 'Short', 'OK'],
    ['2026-09-10', 'SPY-200', 'Harness & "kit"', '', '02', 'Spyder - McBride', '2026-10-01 00:00:00', '2026-10', '1e-05', '', '0.1', '3', '1', '', '0', '0', '1', '1', '2.99999', '-2.75001', 'Covered', 'Short', 'Unconfirmed PO'],
  ];
  const sd = [head, ...rows].map((r) => r.join('\t')).join('\r\n') + '\r\n';
  const live = await livePage(bridgeText, sd);
  const got = live.run('supplyDemandRows.map(r=>[r.itemCode,r.yearMonth,r.demandOpenQty,r.demandOpenValue,r.usableSupplyQty,r.monthlyNetQty,r.cumulativeNetQty,r.isCumulativeShortage,r.riskSupplyQty,r.itemDescription])');
  assert.deepEqual(got, [
    ['SPY-100', '2026-09', 10, 12500.5, 4.25, -5.75, -5.75, true, 0, 'Controller board'],
    ['SPY-200', '2026-10', 0.00001, 0.1, 3, 2.99999, -2.75001, true, 1, 'Harness & "kit"'],
  ]);
  for (const tab of ['supplyweekly', 'supplydemand']) {
    live.run(`setTab(${JSON.stringify(tab)})`);
    assert.doesNotMatch(live.els['results-screen'].innerHTML.replace(/<[^>]+>/g, ' '), /\bundefined\b|\bNaN\b|Invalid Date|\b-0\b/, tab);
  }
});

test('whole numbers written as floats (12.0) key a line like the export does (no lost notes)', async () => {
  const head = HEAD.join('\t');
  const row = FIXTURE.split('\r\n')[1].split('\t');
  const at = (h) => HEAD.indexOf(h);
  row[at('LineNumber')] = '1.0';
  row[at('DocumentNumber')] = '45001.0';
  row[at('DocEntry')] = '1001.0';
  const live = await livePage(`${head}\r\n${row.join('\t')}\r\n`);
  row[at('LineNumber')] = '1'; row[at('DocumentNumber')] = '45001'; row[at('DocEntry')] = '1001';
  const qm = await importPage([{ name: 'e.xls', bytes: queryManager(`${head}\r\n${row.join('\t')}\r\n`) }]);
  assert.equal(live.run('allLoadedRows[0].rowKey'), qm.run('allLoadedRows[0].rowKey'));
  assert.equal(live.run('allLoadedRows[0].documentNumber'), '45001');
});

run();
