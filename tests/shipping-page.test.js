// The Shipping page (index.html), 2v4: shipments from SAP deliveries (any carrier) and numbers added by hand, a
// "Check" link per shipment to AfterShip's public tracking page, a manual status per shipment (Shipped / In transit /
// Delayed / Delivered + date + note) saved through the shared notes store, cards and the progress strip from those
// statuses, demo data mode, search, snapshots, and no tracking API calls from the page.
// Run: node tests/shipping-page.test.js. Fixtures are synthetic (harness.js); /api/notes is the real Pages Function
// over a Workers KV stand-in, so nothing leaves the machine.
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, SAP_HEADERS, sapRow, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const ORIGIN = 'https://kpi.example.test';
const TODAY = '2026-10-09'; // a Friday: "this week" starts Monday Oct 5
// The 2v1 KPI query adds four columns to the delivery rows; older exports do not have them.
const SHIP_COLS = ['TrackingNumber', 'ShipMethod', 'ShipToCountry', 'ShipDate'];
const SHIP_HEADERS = [...new Set([...SAP_HEADERS, ...SHIP_COLS])];
const OLD_HEADERS = SAP_HEADERS.filter((h) => !SHIP_COLS.includes(h));
const N = { parcel: '770012345678', usa: '770099990001', freight: '1234567890', ups: '1Z999AA10123456784', puro: '335123456789', delivered: '770077770003', old: '770000000099', receipt: '770000000777' };

const row = (o) => sapRow({ ExportDate: '10/08/2026', ...o });
const due = (d) => ({ DueDate: d, HeaderDueDate: d, LineDueDate: d });
const delivery = (o) => row({ OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', CloseDateSource: 'Delivery', OpenQuantity: '0', FillStatus: 'Complete', ShipMethod: 'FedEx Ground', ShipToCountry: 'CA', ClosedDate: o.ShipDate, ...o });
const ROWS = [
  row({ DocumentNumber: '600', LineNumber: '0', ...due('10/20/2026') }),
  delivery({ DocumentNumber: '600', LineNumber: '0', DeliveryDocNumber: '9001', TrackingNumber: '7700 1234 5678', ShipDate: '10/06/2026', 'Item No.': 'SPY-100', ...due('10/10/2026') }),
  delivery({ DocumentNumber: '600', LineNumber: '1', DeliveryDocNumber: '9001', TrackingNumber: '7700 1234 5678', ShipDate: '10/06/2026', 'Item No.': 'SPY-101', AmountLocal: '500.00', ...due('10/12/2026') }),
  delivery({ DocumentNumber: '601', CustomerVendorName: 'Acme Marine USA', DeliveryDocNumber: '9002', TrackingNumber: N.usa, ShipToCountry: 'US', ShipMethod: 'FedEx International Priority', ShipDate: '10/05/2026', ...due('10/08/2026') }),
  delivery({ DocumentNumber: '602', DeliveryDocNumber: '9003', TrackingNumber: N.freight, ShipMethod: 'FedEx Freight LTL', ShipDate: '10/08/2026', AmountLocal: '20,000.00', ...due('10/09/2026') }),
  delivery({ DocumentNumber: '603', DeliveryDocNumber: '9004', TrackingNumber: N.ups, ShipMethod: 'UPS Standard', ShipDate: '10/07/2026', ...due('10/08/2026') }),
  delivery({ DocumentNumber: '604', DeliveryDocNumber: '9005', TrackingNumber: N.delivered, ShipToCountry: 'US', ShipDate: '10/02/2026', ...due('10/07/2026') }),
  delivery({ DocumentNumber: '605', DeliveryDocNumber: '9006', TrackingNumber: N.old, ShipDate: '08/01/2026', ...due('08/01/2026') }),
  delivery({ DocumentNumber: '606', DeliveryDocNumber: '9007', TrackingNumber: N.puro, ShipMethod: 'Purolator Ground', ShipDate: '09/15/2026', ...due('09/16/2026') }),
  delivery({ DocumentNumber: '607', DeliveryDocNumber: '9008', TrackingNumber: '', ShipDate: '10/07/2026' }),
  row({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'PO Receipt', DocumentNumber: '40', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: '10/05/2026', CloseDateSource: 'Receipt', DeliveryDocNumber: '88', OpenQuantity: '0', TrackingNumber: N.receipt, ShipDate: '10/05/2026' }),
];
const REAL = [N.parcel, N.usa, N.freight, N.ups, N.delivered, N.puro];
const exportFile = (rows = ROWS) => ({ name: 'kpi.xls', bytes: utf16Tsv(SHIP_HEADERS, rows) });

const html = (page) => page.els['results-screen'].innerHTML;
const field = (page, id) => page.ctx.document.getElementById(id);
const listed = (page) => page.run('shippingSortedList(shippingModel().list).map(s=>s.number)');
const card = (page, id) => (html(page).match(new RegExp(`data-focus-key="ship-kpi-${id}"[\\s\\S]*?<span class="kpi-value[^"]*">([^<]*)<`)) || [])[1];
// The classes of the three steps of one shipment's strip.
function strip(page, number) {
  const m = html(page);
  const at = m.indexOf(`data-focus-key="ship-${number}"`);
  assert.ok(at > 0, `row ${number} is listed`);
  const head = m.slice(at, m.indexOf('</button>', at));
  return [...head.matchAll(/class="ship-step ([^"]*)"/g)].map((x) => x[1]);
}
// A page with the export loaded, on the Shipping page; `real` turns demo data off (as the toggle does).
async function shipPage({ real = true, storage = {}, files = [exportFile()], today = TODAY } = {}) {
  const page = loadPage({ today, storage });
  await upload(page, files);
  page.run("setTab('shipping')");
  if (real) page.run('setShippingDemo(false)');
  return page;
}
// Fills in a shipment's status form (it must be open) and submits it.
function setStatus(page, number, status, date = '', note = '') {
  if (!page.run(`shippingExpanded.has('${number}')`)) page.run(`toggleShipment('${number}')`);
  field(page, `ship-st-${number}`).value = status;
  field(page, `ship-sd-${number}`).value = date;
  field(page, `ship-sn-${number}`).value = note;
  page.run(`shippingStatusSubmit(null,'${number}')`);
}

test('delivery rows read TrackingNumber, ShipMethod, ShipToCountry and ShipDate; an export without them loads as before', async () => {
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile()]);
  const d = page.run(`allLoadedRows.find(r=>r.deliveryDocNumber==='9002')`);
  assert.deepEqual([d.trackingNumber, d.shipMethod, d.shipToCountry, page.run(`displayDate(allLoadedRows.find(r=>r.deliveryDocNumber==='9002').shipDate)`)], [N.usa, 'FedEx International Priority', 'US', '2026-10-05']);
  assert.equal(page.run(`displayDate(allLoadedRows.find(r=>r.deliveryDocNumber==='9002').lineDueDate)`), '2026-10-08');

  const old = loadPage({ today: TODAY });
  await upload(old, [{ name: 'old.xls', bytes: utf16Tsv(OLD_HEADERS, [sapRow({}), sapRow({ DocumentNumber: '3', OrderType: 'Sales Delivery', Status: 'Closed', ClosedDate: '08/28/2026', CloseDateSource: 'Delivery', DeliveryDocNumber: '77', OpenQuantity: '0' })]) }]);
  assert.deepEqual(old.run('allLoadedRows.map(r=>[r.trackingNumber,r.shipMethod,r.shipToCountry,r.shipDate])'), [['', '', '', ''], ['', '', '', '']]);
  old.run("setTab('shipping');setShippingDemo(false)");
  assert.match(html(old), /This export has no TrackingNumber column/);
  assert.match(html(old), /No tracking numbers on deliveries shipped in the 30 days to 2026-09-03/);
  assert.deepEqual(old.errors, []);
});

test('every carrier is listed: sales deliveries shipped in the 30 days to the export date, numbers cleaned, receipts left out', async () => {
  const page = await shipPage();
  assert.deepEqual(listed(page).sort(), [...REAL].sort());
  const s = page.run(`(()=>{const s=shippingModel().list.find(x=>x.number==='${N.parcel}');return {rows:s.rows.length,orders:[...s.orders],deliveries:[...s.deliveries],value:s.value,method:s.shipMethod,ship:displayDate(s.shipDate),promised:displayDate(s.promised)}})()`);
  assert.deepEqual(s, { rows: 2, orders: ['600'], deliveries: ['9001'], value: 1500, method: 'FedEx Ground', ship: '2026-10-06', promised: '2026-10-10' });
  // The carrier is a label from the ship method (or a UPS 1Z number); nothing is skipped any more.
  const carrier = (n) => page.run(`shipCarrier(shippingModel().list.find(x=>x.number==='${n}'))`);
  assert.deepEqual([N.parcel, N.freight, N.ups, N.puro].map(carrier), ['FedEx', 'FedEx Freight', 'UPS', 'Purolator']);
  assert.equal(page.run("shipCarrier({number:'1Z999AA10123456785',shipMethod:''})"), 'UPS');
  assert.equal(page.run("shipCarrier({number:'123456789',shipMethod:''})"), 'Carrier not set');
  assert.equal(page.run('typeof shipOtherCarrier'), 'undefined');
  const m = html(page);
  assert.match(m, /<h1 class="page-title"[^>]*>Shipping<\/h1>/);
  assert.match(m, /as of 2026-10-08 · 6 shipments with a tracking number/);
  assert.doesNotMatch(m, /another carrier/);
});

test('each shipment has a Check link to AfterShip in a new tab, in its row and in its details', async () => {
  const page = await shipPage();
  let m = html(page);
  for (const n of REAL) {
    assert.match(m, new RegExp(`<a class="btn ship-check" href="https://www\\.aftership\\.com/track/${n}" target="_blank" rel="noopener" data-focus-key="ship-check-${n}" data-tip="Opens AfterShip’s public tracking page for ${n} \\([^)]+\\) in a new tab; then set the status here\\.">Check</a>`), n);
  }
  // Never inside the row's button (a link in a button is invalid markup).
  for (const [head] of m.matchAll(/<button type="button" class="ship-head"[\s\S]*?<\/button>/g)) assert.doesNotMatch(head, /<a /);
  assert.doesNotMatch(m, /fedex\.com\/fedextrack/);
  page.run(`toggleShipment('${N.ups}')`);
  m = html(page);
  assert.match(m.slice(m.indexOf(`id="ship-detail-${N.ups}"`)), new RegExp(`<a class="btn" href="https://www\\.aftership\\.com/track/${N.ups}" target="_blank" rel="noopener"`));
  assert.equal(page.run("shipTrackUrl('A B/1')"), 'https://www.aftership.com/track/A%20B%2F1');
});

test('the page never calls a tracking API: no /api/shipping (GET, PUT or refresh) and no carrier site', async () => {
  const calls = [];
  const page = loadPage({ today: TODAY });
  Object.assign(page.ctx, { fetch: async (u, init = {}) => { calls.push(`${init.method || 'GET'} ${u}`); return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }); }, location: { href: ORIGIN + '/', protocol: 'https:' } });
  await upload(page, [exportFile()]);
  page.run("setTab('shipping')");
  page.run('setShippingDemo(false)');
  page.run(`toggleShipment('${N.parcel}')`);
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(calls.filter((c) => /shipping|fedex|aftership|track/i.test(c)), []);
  for (const fn of ['shippingLoad', 'shippingSync', 'shippingRefresh', 'shippingQueueSync']) assert.equal(page.run(`typeof ${fn}`), 'undefined', fn);
  assert.doesNotMatch(html(page), /Refresh now|data-focus-key="ship-refresh"/);
});

test('manual status: saved in this browser on a static host, drives the chip, the strip and the cards', async () => {
  const page = await shipPage();
  // Nothing checked yet: every shipment is "Not checked", the first step current, and all count as not checked.
  assert.deepEqual(['transit', 'delayed', 'delivered', 'stale'].map((id) => card(page, id)), ['0', '0', '0', '6']);
  assert.deepEqual(strip(page, N.parcel), ['current', 'todo', 'todo']);
  assert.match(html(page), /<span class="status-chip warn">Not checked<\/span><span class="ship-eta warn-text">Never checked<\/span>/);

  setStatus(page, N.parcel, 'transit', '2026-10-09', 'At the Regina hub');
  setStatus(page, N.freight, 'shipped', '2026-10-08');
  setStatus(page, N.ups, 'delayed', '2026-10-09', 'Weather hold');
  setStatus(page, N.delivered, 'delivered', '2026-10-08');
  setStatus(page, N.usa, 'delivered', '2026-10-01'); // delivered last week
  // Saved through the shared notes store, which keeps it in this browser here (file / static host).
  const saved = JSON.parse(page.storage.spyderKpiShipmentsV1);
  assert.deepEqual(Object.keys(saved).sort(), [N.parcel, N.freight, N.ups, N.delivered, N.usa].map((n) => `st:${n}`).sort());
  assert.deepEqual({ ...saved[`st:${N.parcel}`], at: 'x' }, { order: '600', number: N.parcel, status: 'transit', statusDate: '2026-10-09', note: 'At the Regina hub', by: '', at: 'x' });
  assert.match(page.els.toast.innerHTML, /770099990001: Delivered Oct 1 saved in this browser\./);
  // Hand-added number lists ignore status entries.
  assert.deepEqual(page.run('shippingManualEntries()'), []);

  assert.deepEqual(['transit', 'delayed', 'delivered', 'stale'].map((id) => card(page, id)), ['2', '1', '1', '1']);
  assert.match(html(page), /data-tip="In transit: 2 shipments on the way: marked Shipped or In transit, worth \$21,500; click to list only these\."/);
  assert.deepEqual(strip(page, N.parcel), ['done', 'current', 'todo']);
  assert.deepEqual(strip(page, N.freight), ['current', 'todo', 'todo']);
  assert.deepEqual(strip(page, N.ups), ['done', 'current exception', 'todo']);
  assert.deepEqual(strip(page, N.delivered), ['done', 'done', 'current']);
  const m = html(page);
  assert.match(m, /<span class="status-chip bad">Delayed<\/span>/);
  assert.match(m, /<em>Delayed<\/em>/);
  // Delivered against the promised date (Oct 7): one day late.
  assert.match(m, /<span class="status-chip good">Delivered<\/span><span class="ship-eta crit-text">Oct 8 · 1 day late<\/span>/);
  assert.match(m, /<span class="status-chip ">In transit<\/span><span class="ship-eta ">Checked just now<\/span>/);
  // Delayed first, then not checked, delivered last.
  assert.deepEqual(listed(page).slice(0, 2), [N.ups, N.puro]);
  assert.deepEqual(listed(page).slice(-2), [N.delivered, N.usa], 'delivered last, newest first');
  // The open row shows the status, note and who checked, and its form keeps the saved values.
  const detail = m.slice(m.indexOf(`id="ship-detail-${N.parcel}"`));
  assert.match(detail, /<span>Status<\/span><strong>In transit · Oct 9<\/strong>/);
  assert.match(detail, /<p class="ship-alert calm">At the Regina hub<\/p>/);
  assert.match(detail, new RegExp(`<select id="ship-st-${N.parcel}"[^>]*>[\\s\\S]*?<option value="transit" selected>In transit</option>`));
  assert.match(detail, /<span class="m">SPY-100<\/span>/);
  assert.deepEqual(page.errors, []);
});

test('cards filter the list; Not checked in 2+ days counts statuses saved 2 or more days ago and never-checked ones', async () => {
  const at = (d) => `${d}T10:00:00.000Z`;
  const storage = { spyderKpiShipmentsV1: JSON.stringify({
    [`st:${N.parcel}`]: { order: '600', number: N.parcel, status: 'transit', statusDate: '2026-10-06', note: '', by: 'Ann', at: at('2026-10-06') },
    [`st:${N.freight}`]: { order: '602', number: N.freight, status: 'shipped', statusDate: '2026-10-08', note: '', by: 'Ann', at: at('2026-10-08') },
    [`st:${N.delivered}`]: { order: '604', number: N.delivered, status: 'delivered', statusDate: '2026-10-03', note: '', by: 'Ann', at: at('2026-10-03') },
    [`st:${N.usa}`]: { order: '601', number: N.usa, status: 'delayed', statusDate: '', note: 'customs', by: 'Ann', at: at('2026-10-01'), deleted: true },
  }) };
  // Real statuses exist, so demo data is off by default.
  const page = await shipPage({ real: false, storage });
  assert.equal(page.run('shippingDemoOn()'), false);
  assert.deepEqual(['transit', 'delayed', 'delivered', 'stale'].map((id) => card(page, id)), ['2', '0', '0', '4']);
  assert.deepEqual(page.run('shippingModel().groups.stale.map(s=>s.number)').sort(), [N.parcel, N.usa, N.ups, N.puro].sort());
  page.run("setShippingFilter('stale')");
  let m = html(page);
  assert.match(m, /data-focus-key="ship-kpi-stale" aria-pressed="true"/);
  assert.equal([...m.matchAll(/class="ship-num">([^<]+)</g)].length, 4);
  assert.match(m, /only shipments not checked in 2\+ days/);
  page.run("setShippingFilter('stale')");
  m = html(page);
  assert.equal([...m.matchAll(/class="ship-num">([^<]+)</g)].length, 6);
});

test('a manual status round-trips through the shared notes store (/api/notes): every browser that signs in sees it', async () => {
  const site = await notesSite();
  const a = await notesBrowser(site, 'Kareena', '2026-10-07');
  assert.equal(a.run('sharedNotes.state'), 'shared');
  assert.match(html(a), /Checked by hand · statuses shared with everyone/);
  setStatus(a, N.ups, 'delayed', '2026-10-07', 'Held at the border');
  assert.match(a.els.toast.innerHTML, /1Z999AA10123456784: Delayed Oct 7 saved for everyone\./);
  await a.run('flushSharedNotes({all:true})');
  const stored = site.kv.json('overrides').shipments[`st:${N.ups}`];
  assert.deepEqual({ ...stored, at: 'x' }, { order: '603', number: N.ups, status: 'delayed', statusDate: '2026-10-07', note: 'Held at the border', by: 'Kareena', at: 'x' });

  // A second browser (its own storage, the next day): demo off on its own (a real status exists), the status shows.
  const b = await notesBrowser(site, 'Jamie Cole', '2026-10-08', { real: false });
  assert.equal(b.run('shippingDemoOn()'), false);
  assert.equal(card(b, 'delayed'), '1');
  assert.match(html(b), /<span class="status-chip bad">Delayed<\/span>/);
  setStatus(b, N.ups, 'delivered', '2026-10-08', '');
  await b.run('flushSharedNotes({all:true})');
  a.run('sharedNotes.syncedAt=0');
  await a.ctx.syncSharedNotes();
  a.run('renderResults()');
  assert.equal(a.run(`shippingStatusEntries().get('${N.ups}').status`), 'delivered');
  assert.equal(site.calls.filter((c) => /shipping/.test(c)).length, 0, 'no /api/shipping call');
  assert.deepEqual([...a.errors, ...b.errors], []);
});

test('Add tracking #: any carrier, saved in this browser without a server, linked to its order, searchable, removable', async () => {
  const page = await shipPage();
  field(page, 'ship-add-number').value = 'nope';
  page.run('shippingAddManual()');
  assert.match(field(page, 'ship-add-status').textContent, /Type a tracking number/);
  field(page, 'ship-add-number').value = '7700 2222 3333';
  field(page, 'ship-add-order').value = 'SO 600';
  page.run('shippingAddManual()');
  const saved = JSON.parse(page.storage.spyderKpiShipmentsV1);
  assert.deepEqual(Object.keys(saved), ['770022223333']);
  assert.equal(saved['770022223333'].order, '600');
  assert.match(page.els.toast.innerHTML, /Tracking # 770022223333 added to order 600\. Click Check to look it up, then set its status\./);
  assert.equal(field(page, 'ship-add-status').textContent, '');
  page.run("toggleShipment('770022223333')");
  const m = html(page);
  assert.match(m, /class="ship-num">770022223333<\/span><span class="ship-sub">Carrier not set · Firefly RV · SO 600 · added by hand</);
  assert.match(m.slice(m.indexOf('id="ship-detail-770022223333"')), /<td class="strong">600<\/td>/);
  // A status on it is its own entry; the number stays listed as added by hand.
  setStatus(page, '770022223333', 'shipped', '2026-10-09');
  assert.deepEqual(page.run('shippingManualEntries().map(e=>e.number)'), ['770022223333']);
  page.run("onGlobalSearchInput('770022223333');applyGlobalSearch()");
  assert.deepEqual(page.run('globalSearchResults(currentMetrics()).rows.map(x=>[searchRowType(x.r),x.r.documentNumber])'), [['Sales order', '600']]);
  page.run("clearGlobalSearch();setTab('shipping');shippingRemoveManual('770022223333')");
  assert.equal(JSON.parse(page.storage.spyderKpiShipmentsV1)['770022223333'].deleted, true);
  assert.ok(!listed(page).includes('770022223333'));
});

test('demo data: on by default with no real statuses, clearly labelled, 12 made-up shipments covering every stage', async () => {
  const page = await shipPage({ real: false });
  assert.equal(page.run('shippingDemoOn()'), true);
  const m = html(page);
  assert.match(m, /<div class="ship-demo" role="note" aria-label="Demo data"><span class="ship-demo-tag">Demo data<\/span><span>These 12 shipments are made up \(fake customers and tracking numbers\) to show how the page works\. Statuses set here are not kept\.<\/span><\/div>/);
  assert.match(m, /data-focus-key="ship-demo" aria-pressed="true" onclick="setShippingDemo\(false\)"[^>]*>Show real shipments</);
  assert.match(page.run('shippingHeadMeta()'), /^demo data · 12 made-up shipments$/);
  const list = page.run('shippingModel().list.map(s=>({n:s.number,c:s.customer,st:s.status,x:s.crossBorder,stale:s.stale}))');
  assert.equal(list.length, 12);
  assert.ok(list.every((s) => /^DEMO\d+$/.test(s.n) && /^Demo /.test(s.c)), 'fake names and numbers only');
  for (const st of ['shipped', 'transit', 'delayed', 'delivered', '']) assert.ok(list.some((s) => s.st === st), `covers ${st || 'not checked'}`);
  assert.ok(list.some((s) => s.x && s.st === 'delayed'), 'a cross-border delay');
  assert.ok(list.some((s) => s.x && s.st === 'transit'), 'cross-border in transit');
  assert.ok(list.some((s) => s.stale && s.st), 'one checked more than 2 days ago');
  const counts = ['transit', 'delayed', 'delivered', 'stale'].map((id) => Number(card(page, id)));
  assert.ok(counts.every((c) => c > 0), `every card has a demo count: ${counts}`);
  assert.ok(!listed(page).some((n) => REAL.includes(n)), 'real deliveries are not mixed in');
  assert.match(m, /class="data-table ship-cross"[\s\S]*Demo Off-Road Ltd/);
  // Demo shipments have no order lines; the Check link warns that AfterShip will not find a demo number.
  page.run("toggleShipment('DEMO10000005')");
  assert.match(html(page), /A demo shipment: it has no order lines\./);
  assert.match(html(page), /data-tip="Demo number: opens AfterShip in a new tab, which will not find it\.">Check</);
  // No Add tracking # form in demo mode.
  assert.doesNotMatch(html(page), /ship-add-number/);
});

test('demo data: statuses set on demo shipments stay on the page, never in the store; toggle off shows the real list', async () => {
  const page = await shipPage({ real: false });
  setStatus(page, 'DEMO10000009', 'transit', '2026-10-09', 'trying it out');
  assert.equal(page.run("shippingModel().list.find(s=>s.number==='DEMO10000009').status"), 'transit');
  assert.match(page.els.toast.innerHTML, /DEMO10000009: In transit Oct 9 saved \(demo only, not kept\)\./);
  assert.equal(page.storage.spyderKpiShipmentsV1, undefined, 'nothing saved');
  assert.equal(page.run('getSharedShipments()["st:DEMO10000009"]'), undefined);
  page.run('setShippingDemo(false)');
  assert.equal(page.storage.spyderKpiShipDemo, '0');
  assert.doesNotMatch(html(page), /class="ship-demo"/);
  assert.match(html(page), /data-focus-key="ship-demo" aria-pressed="false" onclick="setShippingDemo\(true\)"[^>]*>Show demo data</);
  assert.deepEqual(listed(page).sort(), [...REAL].sort());
  // The viewer's choice is remembered in this browser.
  const again = await shipPage({ real: false, storage: { spyderKpiShipDemo: '0' } });
  assert.equal(again.run('shippingDemoOn()'), false);
  const on = await shipPage({ real: false, storage: { spyderKpiShipDemo: '1', spyderKpiShipmentsV1: JSON.stringify({ [`st:${N.parcel}`]: { order: '600', number: N.parcel, status: 'transit', by: '', at: '2026-10-08T10:00:00.000Z' } }) } });
  assert.equal(on.run('shippingDemoOn()'), true);
  assert.match(html(on), /1 real status has been saved\./);
});

test('demo data never reaches search, Order Health or other pages', async () => {
  const page = await shipPage({ real: false });
  page.run("onGlobalSearchInput('DEMO10000005');applyGlobalSearch()");
  assert.deepEqual(page.run('globalSearchResults(currentMetrics()).rows.length'), 0);
  page.run("onGlobalSearchInput('Demo RV Co');applyGlobalSearch()");
  assert.deepEqual(page.run('globalSearchResults(currentMetrics()).rows.length'), 0);
  for (const tab of ['weekly', 'monthly', 'warehouses']) {
    page.run(`clearGlobalSearch();setTab('${tab}')`);
    assert.doesNotMatch(html(page), /DEMO1000|Demo RV Co|Demo data/, tab);
  }
  assert.doesNotMatch(JSON.stringify(page.run('currentMetrics().allRows.map(r=>[r.name,r.trackingNumber])')), /DEMO|Demo /);
});

test('one TrackNo field with several numbers: commas, &, + or "and", or two whole numbers with a space between', async () => {
  const page = loadPage({ today: TODAY });
  const split = (v) => page.run(`shipSplit(${JSON.stringify(v)})`);
  assert.deepEqual(split('770012345678 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(split('770012345678 & 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(split('770012345678 and 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(split('7700 1234 5678, 7700-1234-5679 + 1234567890'), ['770012345678', '770012345679', '1234567890']);
  assert.deepEqual(split('7700 1234 5678'), ['770012345678'], 'grouped digits are one number');
  // Same rule as the dormant server module (shared/fedex.mjs splitTrackingNumbers).
  const { splitTrackingNumbers } = await import('../shared/fedex.mjs');
  for (const v of ['770012345678 770012345679', '7700 1234 5678 and 7700 1234 5679', 'a & b', '1234567890 + 7700-1234-5678', ' SANDBOX123 ']) assert.deepEqual(split(v), splitTrackingNumbers(v), v);
  // A delivery row keeps both numbers; the two parcels share its value, so a card total counts the delivery once.
  const two = await shipPage({ files: [exportFile([delivery({ DocumentNumber: '700', DeliveryDocNumber: '9700', ShipDate: '10/06/2026', TrackingNumber: '770012345678 770012345679', AmountLocal: '1,000.00', ...due('10/10/2026') })])] });
  assert.deepEqual(listed(two).sort(), ['770012345678', '770012345679']);
  assert.deepEqual(two.run('shippingModel().list.map(s=>s.value)'), [500, 500]);
  assert.equal(page.run("shipClean('Will Call')"), '');
});

test('Shipping has a first-visit hint (Stream A hints): dismissed once per browser, back with Show hints again, never in a snapshot', async () => {
  const page = await shipPage();
  assert.match(html(page), /<div class="hint-card print-hide" role="note" aria-label="Hint" data-hint="shipping">[\s\S]*?click <strong>Check<\/strong>/);
  page.run("dismissHint('shipping');renderResults()");
  assert.doesNotMatch(html(page), /data-hint="shipping"/);
  page.run('resetHints()');
  assert.match(html(page), /data-hint="shipping"/);
  page.run('isSnapshotView=true;renderResults()');
  assert.doesNotMatch(html(page), /data-hint="shipping"/);
});

test('search covers export tracking numbers of every carrier, typed with or without spaces', async () => {
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile()]);
  const search = (q) => { page.run(`onGlobalSearchInput(${JSON.stringify(q)});applyGlobalSearch()`); return page.run('globalSearchResults(currentMetrics()).rows.map(x=>[searchRowType(x.r),x.r.documentNumber,x.r.itemCode])'); };
  assert.deepEqual(search('770012345678'), [['Delivery', '600', 'SPY-100'], ['Delivery', '600', 'SPY-101']]);
  assert.deepEqual(search('7700 1234 5678'), [['Delivery', '600', 'SPY-100'], ['Delivery', '600', 'SPY-101']]);
  assert.deepEqual(search(N.ups), [['Delivery', '603', 'SPY-100']]);
});

test('a shared snapshot keeps the saved statuses (and the demo choice), shows no form and never calls the server', async () => {
  const page = await shipPage();
  setStatus(page, N.ups, 'delayed', '2026-10-09', 'Weather hold');
  let payload = '';
  Object.assign(page.ctx, { buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  await page.ctx.exportShareSnapshot();
  const data = JSON.parse(payload);
  assert.equal(data.activeTab, 'shipping');
  assert.equal(data.shipping.manual[`st:${N.ups}`].status, 'delayed');
  assert.equal(data.shipping.demo, false);

  const snap = loadPage({ today: '2026-10-20' });
  const calls = [];
  Object.assign(snap.ctx, { fetch: async (u) => { calls.push(u); throw new Error('no network'); }, location: { href: 'file:///snap.html', protocol: 'file:' } });
  snap.els['embedded-snapshot-data'].dataset.encoding = 'json';
  snap.els['embedded-snapshot-data'].textContent = payload;
  await snap.run('loadEmbeddedSnapshot()');
  const m = html(snap);
  assert.match(m, /Shared snapshot: statuses as they were when it was saved/);
  assert.match(m, /<span class="status-chip bad">Delayed<\/span>/);
  assert.doesNotMatch(m, /ship-add-number|ship-st-|data-focus-key="ship-demo"/);
  assert.deepEqual(calls, []);
});

test('notes store page helpers keep status, statusDate and note, and clean bad values', async () => {
  const page = await shipPage();
  page.run("sharedNotesPatchShipments({'st:770012345678':{order:'600',number:'770012345678',status:'transit',statusDate:'2026-10-09',note:'At hub'},'st:1234567890':{order:'',number:'1234567890',status:'lost',statusDate:'10/09/2026',note:'x'.repeat(300)}})");
  const got = page.run('getSharedShipments()');
  assert.deepEqual([got['st:770012345678'].status, got['st:770012345678'].statusDate, got['st:770012345678'].note], ['transit', '2026-10-09', 'At hub']);
  assert.equal(got['st:1234567890'].status, undefined, 'an unknown status is dropped');
  assert.equal(got['st:1234567890'].statusDate, '');
  assert.equal(got['st:1234567890'].note.length, 200);
  assert.equal(page.run("shippingStatusEntries().has('1234567890')"), false);
  assert.equal(page.run("shippingStatusEntries().get('770012345678').note"), 'At hub');
});

test('every card, button, link, column header and shipment row has a plain-English tooltip; markup is balanced', async () => {
  for (const real of [true, false]) {
    const page = await shipPage({ real });
    const n = real ? N.usa : 'DEMO10000005';
    page.run(`toggleShipment('${n}')`);
    const m = html(page);
    const own = m.slice(m.indexOf('class="ship-bar'));
    for (const tag of own.match(/<(button|th|a|select|input)\b[^>]*>/g)) assert.match(tag, /data-tip="[^"]{12,}"/, tag);
    const kpis = own.match(/<[a-z]+ [^>]*class="(?:[^"]*\s)?kpi(?:\s[^"]*)?"[^>]*>/g);
    assert.equal(kpis.length, 4);
    assert.match(page.els['app-sidebar'].innerHTML, /<button [^>]*data-focus-key="nav-shipping"[^>]*data-tip="Recent deliveries, checked by hand on tracking pages\."/);
    assert.doesNotMatch(m.replace(/<[^>]+>/g, ' '), /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]/);
    assert.doesNotMatch(m, /FedEx statuses|Live FedEx|In customs|Out for delivery/);
    const count = (needle) => m.split(needle).length - 1;
    for (const tag of ['div', 'table', 'tr', 'td', 'section', 'button', 'span', 'form', 'label', 'details', 'select', 'a', 'p']) {
      assert.equal(count(`<${tag} `) + count(`<${tag}>`) + count(`<${tag}\n`), count(`</${tag}>`), `unbalanced <${tag}> (${real ? 'real' : 'demo'})`);
    }
    assert.deepEqual(page.errors, []);
  }
});

test('SAP text and notes cannot inject markup into the Shipping page', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const page = await shipPage({ files: [exportFile([delivery({ DocumentNumber: '700', CustomerVendorName: evil, ShipMethod: evil, ShipToCountry: '<b>', DeliveryDocNumber: '9100', TrackingNumber: `${N.parcel}, ${evil}`, ShipDate: '10/06/2026', 'Item No.': evil })])] });
  setStatus(page, N.parcel, 'delayed', '2026-10-09', `"><script>x</script>${evil}`);
  page.run(`toggleShipment('${N.parcel}');toggleShipment('${N.parcel}')`);
  assert.doesNotMatch(html(page), /<img src=x|<script>x/);
  assert.deepEqual(listed(page), [N.parcel]);
});

// --- The hosted site: /api/notes and /api/people over one KV stand-in (no /api/shipping) ---
function memoryKv() {
  const map = new Map();
  return {
    async get(k, o) { const v = map.has(k) ? map.get(k) : null; return v !== null && o && (o === 'json' || o.type === 'json') ? JSON.parse(v) : v; },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); },
    async list() { return { keys: [...map.keys()].map((name) => ({ name })), list_complete: true }; },
    json(k) { return map.has(k) ? JSON.parse(map.get(k)) : null; },
  };
}
async function notesSite() {
  const kv = memoryKv();
  const env = { REPORT_STORE: kv };
  const fns = { '/api/notes': (await import('../functions/api/notes.js')).onRequest, '/api/people': (await import('../functions/api/people.js')).onRequest };
  const site = { kv, env, calls: [] };
  site.fetch = async (url, init = {}) => {
    site.calls.push(`${init.method || 'GET'} ${url}`);
    if (!fns[url]) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return fns[url]({ request: new Request(ORIGIN + url, { ...init, headers: { ...(init.headers || {}), Origin: ORIGIN } }), env, params: {} });
  };
  return site;
}
async function notesBrowser(site, name, today = TODAY, { real = true } = {}) {
  const page = loadPage({ today, storage: { spyderKpiEditorName: name } });
  Object.assign(page.ctx, { fetch: site.fetch, location: { href: ORIGIN + '/', protocol: 'https:' } });
  await upload(page, [exportFile()]);
  await page.ctx.syncSharedNotes();
  page.run("setTab('shipping')");
  if (real) page.run('setShippingDemo(false)');
  return page;
}

run();
