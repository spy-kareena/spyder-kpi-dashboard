// Regression tests for index.html. No dependencies: run with `node tests/dashboard.test.js`.
// The page's own scripts run in a Node vm with a small DOM stub; fixtures are synthetic (no SAP data).
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, SAP_HEADERS, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

// --- Import ------------------------------------------------------------------------------------------
test('SAP UTF-16 export: every row kept, quotes literal, numbers and dates read', async () => {
  const page = loadPage();
  const rows = [
    sapRow({ DocumentNumber: '501', CustomerVendorName: '""DANIEL DOUGLAS, JR."' }),
    sapRow({ DocumentNumber: '502', CustomerVendorName: '""DANIEL DOUGLAS, JR."', OpenQuantity: '5,000.000', Quantity: '5,000.000' }),
    sapRow({ DocumentNumber: '503', CustomerVendorName: 'Plain Name' }),
  ];
  await upload(page, [{ name: 'kpi export.xls', bytes: sapExport(rows) }]);
  const got = page.run('parsedRows.map(r=>({doc:r.documentNumber,name:r.name,open:r.openQuantity,due:displayDate(r.dueDate)}))');
  assert.equal(got.length, 3);
  assert.deepEqual(got.map((r) => r.doc), ['501', '502', '503']);
  assert.equal(got[0].name, '""DANIEL DOUGLAS, JR."');
  assert.equal(got[1].open, 5000);
  assert.equal(got[2].due, '2026-08-01');
});

test('CSV: quoted commas, doubled quotes, and embedded line breaks', async () => {
  const page = loadPage();
  const csv = 'SourceType,DocumentNumber,CustomerVendorName,DueDate,Quantity,OpenQuantity,AmountLocal,Status\r\n'
    + 'Sales Order,601,"Acme, Inc.",2026-08-01,1,1,100,Open\r\n'
    + 'Sales Order,602,"12"" cable\nco",2026-08-02,1,1,100,Open\r\n';
  await upload(page, [{ name: 'so.csv', bytes: new Uint8Array(Buffer.from(csv, 'utf8')) }]);
  const names = page.run('parsedRows.map(r=>r.name)');
  assert.deepEqual(names, ['Acme, Inc.', '12" cable\nco']);
});

test('non-KPI spreadsheet is rejected with a clear message', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'budget.csv', bytes: new Uint8Array(Buffer.from('Account,Budget\nTravel,100\n')) }]);
  assert.equal(page.run('parsedRows.length'), 0);
  assert.match(page.els['upload-error'].textContent, /does not look like a KPI export/);
});

// --- Dates -------------------------------------------------------------------------------------------
test('parseDate: 2-digit years, ISO, US slash, invalid and sentinel values', () => {
  const page = loadPage();
  const d = (v) => page.run(`displayDate(${JSON.stringify(v)})`);
  assert.equal(d('9/3/26'), '2026-09-03');
  assert.equal(d('09/03/2026'), '2026-09-03');
  assert.equal(d('2026-09-03'), '2026-09-03');
  assert.equal(d('20260903'), '2026-09-03');
  assert.equal(d('02/30/2026'), '');
  assert.equal(d('07/16/0202'), '');
  assert.equal(d('02/05/2626'), '');
  assert.equal(d('11/11/1111'), '');
  assert.equal(page.run('isNoCommitDate("11/11/1111")'), true);
  assert.equal(page.run('isInvalidDateValue("07/16/0202")'), true);
  assert.equal(page.run('isInvalidDateValue("11/11/1111")'), false);
});

test('daysFromToday counts whole days across the spring DST change', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({ ExportDate: '03/10/2026' })]) }]);
  assert.equal(page.run('daysFromToday("03/01/2026")'), 9);
});

test('KPIs are evaluated as of ExportDate, not the viewer clock', async () => {
  const page = loadPage({ today: '2026-09-24' });
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({ DueDate: '09/10/2026', LineDueDate: '09/10/2026', HeaderDueDate: '09/10/2026' })]) }]);
  assert.equal(page.run('displayDate(reportToday())'), '2026-09-03');
  assert.notEqual(page.run('parsedRows[0].statusBucket'), 'Past Due');
});

test('implausible dates are listed in the data check instead of producing huge late counts', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({ DocumentNumber: '777', DueDate: '07/16/0202', LineDueDate: '07/16/0202', HeaderDueDate: '07/16/0202' })]) }]);
  assert.equal(page.run('dataQualityIssues.length'), 1);
  assert.equal(page.run('parsedRows[0].statusBucket'), 'Open');
  page.run('setTab("weekly")');
  // The header shows a "Data check" pill; its popover lists what needs fixing.
  assert.match(page.els['results-screen'].innerHTML, /Data check<\/summary><div class="data-check-pop"[^>]*><strong>1 row/);
});

// --- Notes / overrides -------------------------------------------------------------------------------
test('delivery rows get their own note key; open order line keeps the legacy key format', async () => {
  const page = loadPage();
  const line = sapRow({ DocumentNumber: '900', LineNumber: '1', Quantity: '10.000', OpenQuantity: '4.000', AmountLocal: '400.00' });
  const del = sapRow({ DocumentNumber: '900', LineNumber: '1', OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: '08/05/2026', CloseDateSource: 'Delivery', DeliveryDocNumber: '4411', Quantity: '6.000', OpenQuantity: '0', AmountLocal: '600.00', FillStatus: 'Complete' });
  await upload(page, [{ name: 'e.xls', bytes: sapExport([line, del]) }]);
  const keys = page.run('parsedRows.map(rowKey)');
  assert.notEqual(keys[0], keys[1]);
  assert.equal(keys[0], 'Sales Order|1|900|1|SPY-100|Spyder - Lacombe');
});

test('clearing an override status takes effect immediately', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({})]) }]);
  const key = page.run('rowKey(parsedRows[0])');
  page.run(`updateRowOverride(${JSON.stringify(key)},'status','Urgent')`);
  assert.equal(page.run('parsedRows[0].overrideStatus'), 'Urgent');
  page.run(`updateRowOverride(${JSON.stringify(key)},'status','')`);
  assert.equal(page.run('parsedRows[0].overrideStatus'), '');
  assert.equal(page.storage.spyderKpiRowOverridesV1, '{}');
});

// --- Rendering / safety ------------------------------------------------------------------------------
test('every tab renders without errors or leaked undefined/NaN text', async () => {
  const page = loadPage();
  const rows = [
    sapRow({ DocumentNumber: '1', DueDate: '08/20/2026', LineDueDate: '08/20/2026' }),
    sapRow({ DocumentNumber: '2', LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', RescheduleFlag: 'No Commit Date' }),
    sapRow({ DocumentNumber: '3', LineRescheduleDate: '09/20/2026', RescheduleDate: '09/20/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' }),
    sapRow({ DocumentNumber: '3', OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: '08/28/2026', CloseDateSource: 'Delivery', DeliveryDocNumber: '77', OpenQuantity: '0', FillStatus: 'Complete', PerfectOrder: 'Perfect' }),
    sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', DocumentNumber: '40', CustomerVendorCode: 'VEND', CustomerVendorName: 'Vendor Co', DueDate: '08/15/2026', LineDueDate: '08/15/2026' }),
    sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'PO Receipt', DocumentNumber: '40', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: '08/14/2026', CloseDateSource: 'Receipt', DeliveryDocNumber: '88', OpenQuantity: '0' }),
  ];
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  for (const tab of ['weekly', 'purchaseorders', 'supplyweekly', 'monthly', 'warehouses', 'metrics', 'supplydemand']) {
    page.run(`setTab(${JSON.stringify(tab)})`);
    const text = page.els['results-screen'].innerHTML.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]/, `tab ${tab}`);
    const html = page.els['results-screen'].innerHTML;
    const count = (needle) => html.split(needle).length - 1;
    for (const tag of ['div', 'table', 'tr', 'td', 'section', 'select', 'details', 'button', 'span']) {
      const open = count(`<${tag} `) + count(`<${tag}>`) + count(`<${tag}\n`);
      assert.equal(open, count(`</${tag}>`), `tab ${tab}: unbalanced <${tag}>`);
    }
  }
  assert.deepEqual(page.errors, []);
});

test('export values are HTML-escaped (no markup injection from SAP text)', async () => {
  const page = loadPage();
  const evil = '<img src=x onerror=alert(1)>\'";</script>';
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({ CustomerVendorName: evil, 'Item No.': evil, Warehouse: evil, DocumentDate: '07/01/2026', DueDate: '08/01/2026' })]) }]);
  for (const tab of ['weekly', 'monthly', 'warehouses', 'metrics']) {
    page.run(`weeklyTileFilter='allorders';setTab(${JSON.stringify(tab)})`);
    assert.doesNotMatch(page.els['results-screen'].innerHTML, /<img src=x/, `tab ${tab}`);
  }
});

// --- Other exports and file handling -----------------------------------------------------------------
test('supply/demand export: YearMonth stays a month and SAP "Item No." header is read', async () => {
  const page = loadPage();
  const headers = ['#', 'ExportDate', 'Item No.', 'ItemDescription', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'DemandNoCommitQty', 'DemandOpenValue', 'UsableSupplyQty', 'RescheduledSupplyQty', 'UnconfirmedSupplyQty', 'NoCommitSupplyQty', 'LateSupplyQty', 'RiskSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'SupplyRiskFlag'];
  const rows = [
    { '#': '1', ExportDate: '09/03/2026', 'Item No.': 'SPY-100', WarehouseCode: '11', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-10', DemandOpenQty: '10', UsableSupplyQty: '4', MonthlyNetQty: '-6', CumulativeNetQty: '-6', RiskSupplyQty: '0', SupplyRiskFlag: 'OK' },
    { '#': '2', ExportDate: '09/03/2026', 'Item No.': 'SPY-100', WarehouseCode: '11', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-09', DemandOpenQty: '0', UsableSupplyQty: '20', MonthlyNetQty: '20', CumulativeNetQty: '20', RiskSupplyQty: '5', UnconfirmedSupplyQty: '5', LateSupplyQty: '5', SupplyRiskFlag: 'PO Not Confirmed' },
    { '#': '3', ExportDate: '09/03/2026', 'Item No.': 'SPY-200', WarehouseCode: '11', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-09', DemandOpenQty: '8', UsableSupplyQty: '0', MonthlyNetQty: '-8', CumulativeNetQty: '-8', RiskSupplyQty: '0', SupplyRiskFlag: 'OK' },
  ];
  await upload(page, [{ name: 'supply.xls', bytes: utf16Tsv(headers, rows) }]);
  assert.deepEqual(page.run('supplyDemandRows.map(r=>[r.itemCode,r.yearMonth])'), [['SPY-100', '2026-10'], ['SPY-100', '2026-09'], ['SPY-200', '2026-09']]);
  const sd = page.run('buildSupplyDemandSummary()');
  // SPY-100 recovers from its October gap in cumulative terms (cumulative -6 is its worst), SPY-200 is short 8.
  assert.equal(sd.shortageQty, 14);
  // RiskSupplyQty is used instead of adding the overlapping unconfirmed + late columns (5 + 5).
  assert.equal(sd.riskQty, 5);
  page.run('setTab("supplydemand")');
  assert.match(page.els['results-screen'].innerHTML, /Oct 2026/);
});

test('Clear To Build months like "Aug-26" and "2026-08" map to 2026-08', () => {
  const page = loadPage();
  for (const v of ['Aug-26', 'Aug 2026', 'August 2026', '2026-08', '2026-08-01', '08/15/2026']) {
    assert.equal(page.run(`reportMonthKey(${JSON.stringify(v)})`), '2026-08', v);
  }
  assert.equal(page.run('reportMonthKey("Total")'), '');
});

test('the same export uploaded twice is not double counted', async () => {
  const page = loadPage();
  const bytes = sapExport([sapRow({ DocumentNumber: '1' }), sapRow({ DocumentNumber: '2' })]);
  await upload(page, [{ name: 'a.xls', bytes }, { name: 'a (copy).xls', bytes }]);
  assert.equal(page.run('parsedRows.length'), 2);
  assert.match(page.run('dataQualityIssues.map(i=>i.message).join(" ")'), /Ignored 2 rows/);
});

test('addMonths keeps month-end dates inside the target month', () => {
  const page = loadPage();
  assert.equal(page.run('displayDate(addMonths(new Date(2026,7,31),1))'), '2026-09-30');
  assert.equal(page.run('displayDate(addMonths(new Date(2026,9,31),-1))'), '2026-09-30');
  assert.equal(page.run('displayDate(addMonths(new Date(2026,4,31),-3))'), '2026-02-28');
});

test('snapshot payload survives gzip + base64 round trip', async () => {
  const page = loadPage();
  Object.assign(page.ctx, { CompressionStream, DecompressionStream, Blob, Response, btoa, atob });
  const json = JSON.stringify({ notes: "price is $' each </script>  ", n: Array.from({ length: 500 }, (_, i) => i) });
  page.ctx.__json = json;
  const payload = await page.run('encodeSnapshotPayload(__json)');
  assert.equal(payload.encoding, 'gzip-base64');
  page.ctx.__payload = payload;
  const back = await page.run('decodeSnapshotPayload(__payload.encoding,__payload.text)');
  assert.equal(back, json);
});

test('header-level reschedule dates are used when the line-level column is blank', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({ LineRescheduleDate: '', RescheduleDate: '09/20/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' })]) }]);
  assert.equal(page.run('displayDate(rowRealRescheduleDate(parsedRows[0]))'), '2026-09-20');
  assert.equal(page.run('parsedRows[0].statusBucket'), 'Rescheduled');
});

test('non-inventory lines stay out of shipping KPIs until included', async () => {
  const page = loadPage();
  const headers = [...SAP_HEADERS, 'InventoryItem'];
  const rows = [
    { ...sapRow({ DocumentNumber: '1', 'Item No.': 'SPY-100' }), InventoryItem: 'Y' },
    { ...sapRow({ DocumentNumber: '2', 'Item No.': 'TARIFF' }), InventoryItem: 'N' },
  ];
  await upload(page, [{ name: 'e.xls', bytes: utf16Tsv(headers, rows) }]);
  assert.equal(page.run('parsedRows.length'), 1);
  assert.equal(page.run('getMetrics().pastDueRows.length'), 1);
  page.run('setIncludeNonInventory(true)');
  assert.equal(page.run('parsedRows.length'), 2);
  assert.equal(page.run('currentMetrics().pastDueRows.length'), 2);
});

test('"Not At Risk" clears a line from late counts on every tab, and clearing it restores them', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({ DocumentNumber: '1' }), sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '40' })]) }]);
  assert.equal(page.run('currentMetrics().pastDueRows.length'), 1);
  const soKey = page.run('rowKey(parsedRows[0])');
  const poKey = page.run('rowKey(parsedRows[1])');
  page.run(`updateRowOverride(${JSON.stringify(soKey)},'status','Not At Risk')`);
  page.run(`updateRowOverride(${JSON.stringify(poKey)},'status','Not At Risk')`);
  assert.equal(page.run('currentMetrics().pastDueRows.length'), 0);
  page.run('setTab("purchaseorders")');
  assert.match(page.els['results-screen'].innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), /Late \/ missed commit \$0 0 lines/);
  page.run(`updateRowOverride(${JSON.stringify(soKey)},'status','')`);
  assert.equal(page.run('currentMetrics().pastDueRows.length'), 1);
});

test('PO tab shows unconfirmed and missing-price lines', async () => {
  const page = loadPage();
  const po = (o) => sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DueDate: '10/20/2026', LineDueDate: '10/20/2026', ...o });
  await upload(page, [{ name: 'e.xls', bytes: sapExport([po({ DocumentNumber: '41', Confirmed: 'N' }), po({ DocumentNumber: '42', PriceFlag: 'Missing Price', AmountLocal: '0.00' }), po({ DocumentNumber: '43' })]) }]);
  page.run('setTab("purchaseorders")');
  const text = page.els['results-screen'].innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Unconfirmed vendor has not confirmed 1 /);
  assert.match(text, /Missing price open lines with no price 1 /);
});

test('fractional quantities are not rounded away', () => {
  const page = loadPage();
  assert.equal(page.run('fmtNum(0.065)'), '0.065');
  assert.equal(page.run('fmtNum(1234)'), '1,234');
});

test('tab text re-saved by Excel: quoted cells with line breaks or tabs stay in one row', async () => {
  const page = loadPage();
  const lines = [SAP_HEADERS.join('\t')];
  const row = (desc, doc) => SAP_HEADERS.map((h) => (h === 'ItemDescription' ? desc : h === 'DocumentNumber' ? doc : sapRow({})[h] ?? '')).join('\t');
  lines.push(row('"Line one\nLine two"', '1101'), row('"Board\tRev B"', '1102'), row('Plain', '1103'));
  const bytes = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lines.join('\r\n') + '\r\n', 'utf16le')]));
  await upload(page, [{ name: 'resaved.txt', bytes }]);
  assert.deepEqual(page.run('parsedRows.map(r=>[r.documentNumber,r.itemDescription,r.amountLocal])'), [['1101', 'Line one\nLine two', 1000], ['1102', 'Board\tRev B', 1000], ['1103', 'Plain', 1000]]);
});

test('Excel "sep=" hint line is honoured', async () => {
  const page = loadPage();
  const csv = 'sep=;\r\nSourceType;DocumentNumber;CustomerVendorName;DueDate;Quantity;OpenQuantity;AmountLocal;Status\r\nSales Order;701;Acme;2026-08-01;1;1;100;Open\r\n';
  await upload(page, [{ name: 'sep.csv', bytes: new Uint8Array(Buffer.from(csv)) }]);
  assert.equal(page.run('parsedRows.length'), 1);
});

test('a failed Add file keeps the current report on screen', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({})]) }]);
  page.els['results-screen'].style.display = 'block';
  await page.ctx.addFiles([{ name: 'broken.xlsx', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]) }]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(page.run('parsedRows.length'), 1);
  assert.equal(page.els['results-screen'].style.display, 'block');
  assert.match(page.alerts.join(' '), /broken\.xlsx/);
});

test('Clear To Build continuation rows with equal numbers for different CMs are all kept', async () => {
  const page = loadPage();
  const a = 'CM,Month,Total,Clear To Build,At Risk,Late\r\nDSM,Sep 2026,5,5,0,0\r\n,Oct 2026,6,4,2,0\r\n';
  const b = 'CM,Month,Total,Clear To Build,At Risk,Late\r\nIMS,Sep 2026,3,3,0,0\r\n,Oct 2026,6,4,2,0\r\n';
  await upload(page, [{ name: 'a.csv', bytes: new Uint8Array(Buffer.from(a)) }, { name: 'b.csv', bytes: new Uint8Array(Buffer.from(b)) }]);
  assert.equal(page.run('buildRiskRows.length'), 4);
});

test('workbooks in the 1904 date system keep their dates', async () => {
  const page = loadPage();
  const bytes = page.run(`(()=>{
    const ws=XLSX.utils.aoa_to_sheet([["SourceType","DocumentNumber","DueDate","ExportDate","Quantity","OpenQuantity","AmountLocal","Status"],["Sales Order","9","",""," 1","1","100","Open"]]);
    ws.C2={t:'n',v:44773,z:'mm/dd/yyyy'};ws.D2={t:'n',v:44806,z:'mm/dd/yyyy'};
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'S');wb.Workbook={WBProps:{date1904:true}};
    return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));
  })()`);
  await upload(page, [{ name: 'mac.xlsx', bytes: new Uint8Array(bytes) }]);
  assert.equal(page.run('displayDate(parsedRows[0].dueDate)'), '2026-08-01');
});

// --- Redesigned pages ---------------------------------------------------------------------------------
test('supply warehouse names cannot break out of the "Show all" button', async () => {
  const page = loadPage();
  const evil = "O'Neil\");alert(1);('";
  const headers = ['#', 'ExportDate', 'Item No.', 'ItemDescription', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'DemandOpenValue', 'UsableSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'RiskSupplyQty', 'SupplyRiskFlag'];
  const rows = Array.from({ length: 12 }, (_, i) => ({ '#': String(i + 1), ExportDate: '09/03/2026', 'Item No.': `SPY-${i}`, WarehouseCode: '11', WarehouseName: evil, YearMonth: '2026-10', DemandOpenQty: '10', DemandOpenValue: '100', UsableSupplyQty: '0', MonthlyNetQty: '-10', CumulativeNetQty: '-10', RiskSupplyQty: '0', SupplyRiskFlag: 'OK' }));
  await upload(page, [{ name: 'supply.xls', bytes: utf16Tsv(headers, rows) }]);
  page.run('setTab("supplyweekly")');
  const html = page.els['results-screen'].innerHTML;
  assert.match(html, /onclick="toggleTableMore\(this\.dataset\.tableKey\)"/);
  // The name only ever appears HTML-escaped (its quotes as &#39; / &quot;).
  assert.ok(!html.includes("O'Neil") && !html.includes('Neil")'), 'raw warehouse text in markup');
  assert.match(html, /O&#39;Neil&quot;\);alert\(1\);\(&#39;/);
});

test('a replacement report opens on the default view; Add file keeps the view', async () => {
  const page = loadPage();
  const headers = [...SAP_HEADERS, 'InventoryItem'];
  const file = (doc) => utf16Tsv(headers, [{ ...sapRow({ DocumentNumber: doc }), InventoryItem: 'N' }, { ...sapRow({ DocumentNumber: doc + '1' }), InventoryItem: 'Y' }]);
  await upload(page, [{ name: 'a.xls', bytes: file('1') }]);
  page.run("setIncludeNonInventory(true);weeklyTileFilter='allorders';shipScenarioStartDate='2026-08-01';activeTab='monthly'");
  await page.ctx.handleFiles([{ name: 'b.xls', bytes: file('2') }]);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(page.run('[weeklyTileFilter,includeNonInventory,shipScenarioStartDate,activeTab,parsedRows.length]'), ['late', false, '', 'weekly', 1]);
  page.run("weeklyTileFilter='allorders'");
  await page.ctx.handleFiles([{ name: 'b.xls', bytes: file('2') }, { name: 'c.xls', bytes: file('3') }], { adding: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(page.run('weeklyTileFilter'), 'allorders');
});

test('Export PDF prints the long linked-lines list; the screen shows the first 20', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport(Array.from({ length: 25 }, (_, i) => sapRow({ DocumentNumber: String(100 + i) }))) }]);
  const lines = () => page.els['results-screen'].innerHTML.split('class="line-row').length - 1;
  page.run('setTab("weekly")');
  assert.equal(lines(), 20);
  page.run('refreshForPrint()');
  assert.equal(lines(), 25);
  page.run('endPrintMode()');
  assert.equal(lines(), 20);
});

run();
