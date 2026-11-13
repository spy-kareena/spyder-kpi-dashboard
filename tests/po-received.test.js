// Purchase Order Health > Received (owner's pick, Version 2 · Vendor Scorecard): the band of three numbers with their
// marks, the Vendor Scorecard (one row per vendor over 3 months, an All Vendors row equal to the band, sortable, 10 a
// page) and the two trends under it, which follow a vendor picked in the table. Run with `node tests/po-received.test.js`.
// Fixtures are synthetic: two vendors, report day Thursday 09/24/2026 (week Sun 09/20 to Sat 09/26, 3 months from 06/24).
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const V = { ACME: 'Acme Metals', BOLT: 'Bolt Electronics' };
// [vendor, PO, original date, received date, reschedule date, warehouse]
const LINES = [
  ['ACME', '100', '09/10/2026', '09/05/2026', ''], // early (-5)
  ['ACME', '101', '09/10/2026', '09/10/2026', ''], // on time
  ['ACME', '102', '09/10/2026', '09/11/2026', ''], // 1 day late (tolerance: late here, as in the rate)
  ['ACME', '103', '09/10/2026', '09/12/2026', ''], // 2 days late (tolerance)
  ['ACME', '104', '09/10/2026', '09/20/2026', ''], // 10 days late; received this week (Sunday)
  ['ACME', '105', '08/01/2026', '08/18/2026', '08/20/2026'], // reschedule met; 17 days late against the original date
  ['ACME', '106', '08/01/2026', '08/25/2026', '08/20/2026'], // reschedule missed; 24 days late
  ['BOLT', '200', '09/15/2026', '09/14/2026', '', 'CM - Alta'], // early (-1)
  ['BOLT', '201', '09/15/2026', '09/22/2026', '', 'CM - Alta'], // 7 days late; this week
  ['BOLT', '202', '09/22/2026', '09/21/2026', '', 'CM - Alta'], // early; this week
  ['BOLT', '203', '05/01/2026', '05/10/2026', '', 'CM - Alta'], // outside the 3-month window and the 12 weeks
  ['BOLT', '204', '', '09/01/2026', '', 'CM - Alta'], // no original date: received, not scored
];
const po = (o) => sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', ExportDate: '09/24/2026', LineNumber: '0', Warehouse: 'Spyder - Lacombe', DocumentDate: '04/01/2026', ...o });
function rows() {
  const out = [];
  LINES.forEach(([v, doc, orig, recv, res, wh], i) => {
    const common = { DocumentNumber: doc, 'Internal Number': String(9000 + i), CustomerVendorCode: v, CustomerVendorName: V[v], Warehouse: wh || 'Spyder - Lacombe', DueDate: orig, HeaderDueDate: orig, LineDueDate: orig,
      LineRescheduleDate: res, RescheduleDate: res, RescheduleFlag: res ? 'Rescheduled Later Than Original Delivery' : 'No Reschedule' };
    out.push(po({ ...common, Status: 'Closed', KPIStatus: 'Closed', ClosedDate: recv, OpenQuantity: '0', FillStatus: 'Complete' }));
    out.push(po({ ...common, OrderType: 'PO Receipt', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: recv, CloseDateSource: 'Receipt', DeliveryDocNumber: String(7000 + i), OpenQuantity: '0' }));
  });
  // One open line of ACME with a reschedule date: "1 rescheduled line still open".
  out.push(po({ DocumentNumber: '300', 'Internal Number': '9100', CustomerVendorCode: 'ACME', CustomerVendorName: V.ACME, DueDate: '10/01/2026', HeaderDueDate: '10/01/2026', LineDueDate: '10/01/2026',
    LineRescheduleDate: '10/20/2026', RescheduleDate: '10/20/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' }));
  return out;
}
async function received() {
  const page = loadPage({ today: '2026-09-24' });
  await upload(page, [{ name: 'po.xls', bytes: sapExport(rows()) }]);
  page.run("setTab('purchaseorders');supSet('po-view','received')");
  return page;
}
const html = (page) => page.els['results-screen'].innerHTML;
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const band = (h) => (h.match(/<section class="dz-card por-bandcard[\s\S]*?<\/section>/) || [''])[0];
const num = (h, id) => (band(h).match(new RegExp(`<div class="por-num" role="group" aria-label="[^"]+" data-por="${id}"[\\s\\S]*?<span class="por-num-s">[^<]*</span></div>`)) || [''])[0];
const card = (h) => h.slice(h.indexOf('<section class="dz-card por-card'), h.indexOf('</section>', h.indexOf('por-card')));
const cells = (tr) => [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => text(m[1]));
const bodyRows = (h) => [...((card(h).match(/<tbody>([\s\S]*?)<\/tbody>/) || ['', ''])[1]).matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((m) => cells(m[0]));
const footRow = (h) => cells((card(h).match(/<tfoot>([\s\S]*?)<\/tfoot>/) || ['', ''])[1]);
const marks = (h) => [...h.matchAll(/<span class="por-gauge" aria-hidden="true"><span><i style="width:([\d.]+)%;[^"]*"><\/i><\/span><b style="left:([\d.]+)%"><\/b><\/span>/g)].map((m) => [+m[1], +m[2]]);

test('Question 1: the band holds the three numbers, each with a bar and its mark (90% target, 12-week average); no $ in the band', async () => {
  const page = await received();
  const h = html(page);
  assert.match(h, /<h2 class="ohl-q-t" data-tc-skip>How Is Receiving Going\?<\/h2>[\s\S]*?por-bandcard[\s\S]*?<h2 class="ohl-q-t" data-tc-skip>Which Vendors Deliver on Time\?<\/h2>/);
  // On time: 4 of the 10 scored lines (PO 204 has no original date) early or on time, 40%, red; mark at 90.
  const on = num(h, 'ontime');
  assert.equal(text(on), 'On Time · 3 Mo 40% 4 of 10 lines early or on time target 90%');
  assert.match(on, /<span class="por-num-v por-red">40%<\/span>/);
  assert.deepEqual(marks(on), [[40, 90]]);
  assert.match(on, /data-tip="On time, last 3 months: 40%\n• 4 of 10 receipts by the original date\n• \$[\d,]+ received/);
  // Received this week: 3 POs (104, 201, 202); 12 weeks 0,0,0,0,0,0,1,1,2,3,1,3 = 0.9 a week; bar 3 of 3, mark at 0.9 / 3.
  const wk = num(h, 'week');
  assert.equal(text(wk), 'Received This Week 3 POs 3 lines · 12-week average 0.9 POs at or above the 12-week average');
  assert.deepEqual(marks(wk), [[100, 30]]);
  assert.match(wk, /data-tip="Received Sunday to Thursday\n• 3 POs · 3 lines\n• \$[\d,]+/);
  // Reschedule hit: PO 105 met, PO 106 missed; PO 300 is still open.
  const hit = num(h, 'hit');
  assert.equal(text(hit), 'Reschedule Hit · 12 Mo 50% 1 of 2 met commit target 90% · 1 rescheduled line still open');
  assert.deepEqual(marks(hit), [[50, 90]]);
  assert.doesNotMatch(text(band(h)), /\$/);
  // Fill Rate stays removed; About these numbers stays.
  assert.doesNotMatch(h, /Fill rate|fill rate/);
  assert.match(h, /About these numbers|class="dz-about/i);
  assert.deepEqual(page.errors, []);
});

test('Question 2: the scorecard has one row per vendor (lines, share, on time, late, avg / worst days late, hit) and an All Vendors row equal to the band', async () => {
  const page = await received();
  const h = html(page);
  assert.match(card(h), /<h2 class="dz-title"[^>]*>Vendor Scorecard<\/h2>/);
  assert.match(card(h), /<div class="sup-scroll por-scroll" tabindex="0" role="region" aria-label="Vendor scorecard">/);
  // Late Lines, most first, by default. ACME: 7 lines (64% of 11), 2 of 7 on time, late 1, 2, 10, 17, 24 days (avg 10.8);
  // BOLT: 4 lines (36%), 3 scored, 2 on time, one 7 days late, no reschedules.
  assert.deepEqual(bodyRows(h), [
    ['Acme Metals', '7 64% of all', '29% 2 of 7', '5 of 7', '11 days', '24 days', '50% 1 of 2 met 1 line still open'],
    ['Bolt Electronics', '4 36% of all', '67% 2 of 3', '1 of 3', '7 days', '7 days', '— no reschedules'],
  ]);
  // All Vendors: the band's figures (40%, 4 of 10; 50%, 1 of 2; 1 still open), late 6, avg 10.2 -> 10, worst 24.
  assert.deepEqual(footRow(h), ['All Vendors', '11', '40% 4 of 10', '6', '10 days', '24 days', '50% 1 of 2 met 1 line still open']);
  assert.match(card(h), /data-tip="Average 10\.2 days late over 6 lines\."/);
  assert.match(card(h), /data-tip="Acme Metals\n• 5 of 7 lines received late in 3 months\n• Average 10\.8 days late, worst 24\n/);
  assert.match(card(h), /data-tip="Bolt Electronics\n[^"]*• 1 line with no original date \(not scored\)/);
  // Every column title has a tip and is a sort button; the sorted one carries aria-sort.
  const ths = [...card(h).matchAll(/<th\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(ths.length, 8);
  ths.forEach((t) => assert.match(t, /data-tip="[^"]+"/, t));
  assert.equal((card(h).match(/<th[^>]*scope="col"[^>]*><button type="button" class="th-sort por-th" data-focus-key="porecv-sort-\w+" onclick="poRecvSort\('\w+'\)">/g) || []).length, 7);
  assert.match(card(h), /<th class="num" scope="col" aria-sort="descending"[^>]*><button[^>]*porecv-sort-late[^>]*>Late Lines<span class="sort-arrow" aria-hidden="true">↓<\/span>/);
  // The vendor names are buttons with aria-pressed.
  assert.equal((card(h).match(/<button type="button" class="por-ven" data-focus-key="porecv-ven-(ACME|BOLT)" aria-pressed="false"/g) || []).length, 2);
  assert.deepEqual(page.errors, []);
});

test('Sorting by a column title: first click per the column (on time lowest first), the next reverses it', async () => {
  const page = await received();
  page.run("poRecvSort('rate')");
  assert.deepEqual(bodyRows(html(page)).map((r) => r[0]), ['Acme Metals', 'Bolt Electronics']);
  assert.match(card(html(page)), /<th class="c-on" scope="col" aria-sort="ascending"/);
  page.run("poRecvSort('rate')");
  assert.deepEqual(bodyRows(html(page)).map((r) => r[0]), ['Bolt Electronics', 'Acme Metals']);
  assert.match(card(html(page)), /<th class="c-on" scope="col" aria-sort="descending"/);
  page.run("poRecvSort('name')");
  assert.deepEqual(bodyRows(html(page)).map((r) => r[0]), ['Acme Metals', 'Bolt Electronics']);
  assert.equal((card(html(page)).match(/aria-sort=/g) || []).length, 1);
  assert.deepEqual(page.errors, []);
});

test('Picking a vendor switches the trends to it; the band and the All Vendors row stay; again (or the chip) shows all', async () => {
  const page = await received();
  const before = band(html(page));
  const trendsAll = text((card(html(page)).match(/<div class="por-sec">[\s\S]*$/) || [''])[0]);
  assert.match(trendsAll, /^Trends all vendors in view Received on time target 90% 40% of 10 PO lines received in the last 3 months/);
  assert.match(trendsAll, /Received by week 3 POs this week 3 3 lines received this week · 12-week average 0\.9 POs/);
  page.run("poRecvVendor('BOLT')");
  const h = html(page);
  assert.equal(band(h), before);
  assert.deepEqual(footRow(h)[0], 'All Vendors');
  assert.match(card(h), /<tr class="sup-row sel"><td><button type="button" class="por-ven" data-focus-key="porecv-ven-BOLT" aria-pressed="true"/);
  const trends = text((card(h).match(/<div class="por-sec">[\s\S]*$/) || [''])[0]);
  // BOLT: 2 of 3 scored on time (67%); this week 2 POs; its 12 weeks 0,...,0,1,0,0,0,2 (204 in the week of Aug 30) = 0.3.
  assert.match(trends, /^Trends Bolt Electronics × Received on time target 90% 67% of 3 PO lines received in the last 3 months/);
  assert.match(trends, /Received by week 2 POs this week 2 2 lines received this week · 12-week average 0\.3 POs/);
  assert.match(card(h), /<button type="button" class="por-chip" data-focus-key="porecv-clear" onclick="poRecvVendor\(''\)"/);
  page.run("poRecvVendor('BOLT')");
  assert.match(text(card(html(page))), /Trends all vendors in view/);
  page.run("poRecvVendor('ACME');poRecvVendor('')");
  assert.match(text(card(html(page))), /Trends all vendors in view/);
  assert.deepEqual(page.errors, []);
});

test('The page filters narrow the band, the scorecard and the trends', async () => {
  const page = await received();
  page.run("setPoWarehouseFilter(['CM - Alta'])");
  const h = html(page);
  assert.deepEqual(bodyRows(h).map((r) => r[0]), ['Bolt Electronics']);
  assert.equal(text(num(h, 'ontime')), 'On Time · 3 Mo 67% 2 of 3 lines early or on time target 90%');
  assert.match(text(num(h, 'week')), /^Received This Week 2 POs 2 lines/);
  assert.match(text(num(h, 'hit')), /— no closed reschedules/);
  assert.deepEqual(footRow(h), ['All Vendors', '4', '67% 2 of 3', '1', '7 days', '7 days', '— no reschedules']);
  page.run("setPoWarehouseFilter(['ALL']);setPoVendorFilter(['ACME'])");
  assert.deepEqual(bodyRows(html(page)).map((r) => r[0]), ['Acme Metals']);
  assert.equal(text(num(html(page), 'ontime')), 'On Time · 3 Mo 29% 2 of 7 lines early or on time target 90%');
  assert.deepEqual(page.errors, []);
});

test('Print shows every vendor row, no pager; the table pages at 10 vendors on screen', async () => {
  const many = rows();
  for (let i = 0; i < 11; i++) {
    const code = `V${String(i).padStart(2, '0')}`;
    many.push(po({ DocumentNumber: String(400 + i), 'Internal Number': String(9200 + i), CustomerVendorCode: code, CustomerVendorName: `Vendor ${code}`, OrderType: 'PO Receipt', Status: 'Closed', KPIStatus: 'Closed',
      DueDate: '09/10/2026', HeaderDueDate: '09/10/2026', LineDueDate: '09/10/2026', ClosedDate: '09/08/2026', CloseDateSource: 'Receipt', DeliveryDocNumber: String(7100 + i), OpenQuantity: '0' }));
  }
  const page = loadPage({ today: '2026-09-24' });
  await upload(page, [{ name: 'po.xls', bytes: sapExport(many) }]);
  page.run("setTab('purchaseorders');supSet('po-view','received')");
  assert.equal(bodyRows(html(page)).length, 10);
  assert.match(html(page), /1–10 of 13 vendors/);
  page.run('printMode=true;renderResults()');
  assert.equal(bodyRows(html(page)).length, 13);
  assert.doesNotMatch(html(page), /dz-pagefoot/);
  page.run('printMode=false;renderResults()');
  assert.deepEqual(page.errors, []);
});

run();
