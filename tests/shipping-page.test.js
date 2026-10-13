// The Shipping page (index.html): tracking numbers from the export and by hand, FedEx statuses from the server,
// progress strip, cross-border, search, snapshots, and the hosted/static split. Run: node tests/shipping-page.test.js
// Fixtures are synthetic (harness.js, fedex-fixtures.mjs); the server is the real functions/api/shipping.js over a
// Workers KV stand-in, and FedEx is a stand-in, so nothing leaves the machine.
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, SAP_HEADERS, sapRow, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const ORIGIN = 'https://kpi.example.test';
const TODAY = '2026-10-09';
const NOW = new Date(`${TODAY}T10:00:00`).getTime(); // the page's pinned clock (harness loadPage)
// The 2v1 KPI query adds four columns to the delivery rows; older exports do not have them.
const SHIP_COLS = ['TrackingNumber', 'ShipMethod', 'ShipToCountry', 'ShipDate'];
const SHIP_HEADERS = [...new Set([...SAP_HEADERS, ...SHIP_COLS])];
const OLD_HEADERS = SAP_HEADERS.filter((h) => !SHIP_COLS.includes(h));
const N = { parcel: '770012345678', customsDelay: '770099990001', freight: '1234567890', exception: '770055550002', delivered: '770077770003', old: '770000000099', longAgo: '770011110004', receipt: '770000000777' };

const row = (o) => sapRow({ ExportDate: '10/08/2026', ...o });
const due = (d) => ({ DueDate: d, HeaderDueDate: d, LineDueDate: d });
const delivery = (o) => row({ OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', CloseDateSource: 'Delivery', OpenQuantity: '0', FillStatus: 'Complete', ShipMethod: 'FedEx Ground', ShipToCountry: 'CA', ClosedDate: o.ShipDate, ...o });
const ROWS = [
  row({ DocumentNumber: '600', LineNumber: '0', ...due('10/20/2026') }),
  delivery({ DocumentNumber: '600', LineNumber: '0', DeliveryDocNumber: '9001', TrackingNumber: '7700 1234 5678', ShipDate: '10/06/2026', 'Item No.': 'SPY-100', ...due('10/10/2026') }),
  delivery({ DocumentNumber: '600', LineNumber: '1', DeliveryDocNumber: '9001', TrackingNumber: '7700 1234 5678', ShipDate: '10/06/2026', 'Item No.': 'SPY-101', AmountLocal: '500.00', ...due('10/12/2026') }),
  delivery({ DocumentNumber: '601', CustomerVendorName: 'Acme Marine USA', DeliveryDocNumber: '9002', TrackingNumber: N.customsDelay, ShipToCountry: 'US', ShipMethod: 'FedEx International Priority', ShipDate: '10/05/2026', ...due('10/08/2026') }),
  delivery({ DocumentNumber: '602', DeliveryDocNumber: '9003', TrackingNumber: N.freight, ShipMethod: 'FedEx Freight LTL', ShipDate: '10/08/2026', AmountLocal: '20,000.00', ...due('10/09/2026') }),
  delivery({ DocumentNumber: '603', DeliveryDocNumber: '9004', TrackingNumber: N.exception, ShipDate: '10/07/2026', ...due('10/08/2026') }),
  delivery({ DocumentNumber: '604', DeliveryDocNumber: '9005', TrackingNumber: N.delivered, ShipToCountry: 'US', ShipDate: '10/02/2026', ...due('10/07/2026') }),
  delivery({ DocumentNumber: '605', DeliveryDocNumber: '9006', TrackingNumber: N.old, ShipDate: '08/01/2026', ...due('08/01/2026') }),
  delivery({ DocumentNumber: '606', DeliveryDocNumber: '9007', TrackingNumber: N.longAgo, ShipDate: '09/15/2026', ...due('09/16/2026') }),
  delivery({ DocumentNumber: '607', DeliveryDocNumber: '9008', TrackingNumber: '', ShipDate: '10/07/2026' }),
  row({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'PO Receipt', DocumentNumber: '40', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: '10/05/2026', CloseDateSource: 'Receipt', DeliveryDocNumber: '88', OpenQuantity: '0', TrackingNumber: N.receipt, ShipDate: '10/05/2026' }),
];
const exportFile = (rows = ROWS) => ({ name: 'kpi.xls', bytes: utf16Tsv(SHIP_HEADERS, rows) });

let mods;
async function modules() {
  if (!mods) {
    const fx = await import('./fedex-fixtures.mjs');
    const fedex = await import('../shared/fedex.mjs');
    const api = await import('../functions/api/shipping.js');
    mods = { ...fx, ...fedex, onRequest: api.onRequest };
  }
  return mods;
}
// FedEx statuses as the poller would have saved them 12 minutes ago.
async function savedStatuses() {
  const { normalizeTrackResponse, trackResponse, NUMBERS } = await modules();
  const statuses = normalizeTrackResponse(trackResponse(Object.values(NUMBERS)), NOW).statuses;
  statuses[N.longAgo] = { ...statuses[NUMBERS.delivered], number: N.longAgo, deliveredAt: '2026-09-18T12:00:00-06:00', customs: [], customsState: '', destCountry: 'CA' };
  return statuses;
}
// The hosted site: the real Pages Function over a KV stand-in; every page request is same-origin.
async function hostedSite({ fedexKeys = false, statuses } = {}) {
  const { memoryKv, onRequest, INDEX_KEY } = await modules();
  const kv = memoryKv({ [INDEX_KEY]: { v: 1, polledAt: new Date(NOW - 12 * 60000).toISOString(), source: 'cron', statuses: statuses || await savedStatuses(), errors: [] } });
  const env = { REPORT_STORE: kv, ...(fedexKeys ? { FEDEX_CLIENT_ID: 'id-1', FEDEX_CLIENT_SECRET: 'super-secret-key' } : {}) };
  const site = { kv, env, calls: [] };
  site.fetch = async (url, init = {}) => {
    site.calls.push(`${init.method || 'GET'} ${url}`);
    return onRequest({ request: new Request(ORIGIN + url, { ...init, headers: { ...(init.headers || {}), Origin: ORIGIN } }), env, params: {} });
  };
  return site;
}
async function hostedPage(site, files = [exportFile()]) {
  const page = loadPage({ today: TODAY });
  Object.assign(page.ctx, { fetch: site.fetch, location: { href: ORIGIN + '/', protocol: 'https:' } });
  await upload(page, files);
  page.run("setTab('shipping')");
  await settle(page);
  return page;
}
const settle = (page) => page.run('(async()=>{while(shippingState.loading)await shippingState.loading;})()');
const html = (page) => page.els['results-screen'].innerHTML;
const field = (page, id) => page.ctx.document.getElementById(id);
// The classes of the six steps of one shipment's strip.
function strip(page, number) {
  const m = html(page);
  const at = m.indexOf(`data-focus-key="ship-${number}"`);
  assert.ok(at > 0, `row ${number} is listed`);
  const head = m.slice(at, m.indexOf('</button>', at));
  return [...head.matchAll(/class="ship-step ([^"]*)"/g)].map((x) => x[1]);
}
const listed = (page) => page.run('shippingSortedList(shippingModel().list).map(s=>s.number)');

test('delivery rows read TrackingNumber, ShipMethod, ShipToCountry and ShipDate; an export without them loads as before', async () => {
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile()]);
  const d = page.run(`allLoadedRows.find(r=>r.deliveryDocNumber==='9002')`);
  assert.deepEqual([d.trackingNumber, d.shipMethod, d.shipToCountry, page.run(`displayDate(allLoadedRows.find(r=>r.deliveryDocNumber==='9002').shipDate)`)], [N.customsDelay, 'FedEx International Priority', 'US', '2026-10-05']);
  // ShipDate does not change the line's own dates (LineDueDate is still read first).
  assert.equal(page.run(`displayDate(allLoadedRows.find(r=>r.deliveryDocNumber==='9002').lineDueDate)`), '2026-10-08');

  const old = loadPage({ today: TODAY });
  await upload(old, [{ name: 'old.xls', bytes: utf16Tsv(OLD_HEADERS, [sapRow({}), sapRow({ DocumentNumber: '3', OrderType: 'Sales Delivery', Status: 'Closed', ClosedDate: '08/28/2026', CloseDateSource: 'Delivery', DeliveryDocNumber: '77', OpenQuantity: '0' })]) }]);
  assert.deepEqual(old.run('allLoadedRows.map(r=>[r.trackingNumber,r.shipMethod,r.shipToCountry,r.shipDate])'), [['', '', '', ''], ['', '', '', '']]);
  old.run("setTab('shipping')");
  assert.match(html(old), /This export has no TrackingNumber column/);
  assert.match(html(old), /No FedEx tracking numbers on deliveries shipped in the 30 days to 2026-09-03/);
  assert.deepEqual(old.errors, []);
});

test('the list: sales deliveries shipped in the 30 days to the export date, numbers cleaned, receipts left out', async () => {
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile()]);
  assert.deepEqual(listed(page).sort(), [N.parcel, N.customsDelay, N.freight, N.exception, N.delivered, N.longAgo].sort());
  const s = page.run(`(()=>{const s=shippingModel().list.find(x=>x.number==='${N.parcel}');return {rows:s.rows.length,orders:[...s.orders],deliveries:[...s.deliveries],value:s.value,method:s.shipMethod,ship:displayDate(s.shipDate),promised:displayDate(s.promised)}})()`);
  assert.deepEqual(s, { rows: 2, orders: ['600'], deliveries: ['9001'], value: 1500, method: 'FedEx Ground', ship: '2026-10-06', promised: '2026-10-10' });
});

test('static host or file: the page says live status needs the hosted site and still lists the export numbers', async () => {
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile()]);
  page.run("setTab('shipping')");
  const m = html(page);
  assert.equal(page.run('shippingState.state'), 'static');
  assert.match(m, /Live FedEx tracking needs the hosted dashboard/);
  assert.match(m, /<h1 class="page-title"[^>]*>Shipping<\/h1>/);
  assert.match(m, /as of 2026-10-08 · 6 shipments with a FedEx tracking number/);
  for (const n of [N.parcel, N.freight]) assert.match(m, new RegExp(`class="ship-num">${n}<`));
  assert.match(m, /<span class="kpi-value neutral">—<\/span>/);
  assert.match(m, /No live status/);
  assert.deepEqual(strip(page, N.parcel), ['current', 'todo', 'todo', 'todo skip', 'todo', 'todo']);

  // A web server without the API (IIS) answers /api/shipping with its own 404 page.
  const iis = loadPage({ today: TODAY });
  Object.assign(iis.ctx, { fetch: async () => new Response('<!doctype html>Not found', { status: 404, headers: { 'content-type': 'text/html' } }), location: { href: ORIGIN + '/', protocol: 'https:' } });
  await upload(iis, [exportFile()]);
  iis.run("setTab('shipping')");
  await settle(iis);
  assert.equal(iis.run('shippingState.state'), 'static');
  assert.match(html(iis), /Live FedEx tracking needs the hosted dashboard/);
  assert.deepEqual(iis.errors, []);
});

test('hosted: header shows when FedEx was checked and the next check; cards count each stage', async () => {
  const site = await hostedSite();
  const page = await hostedPage(site);
  assert.equal(page.run('shippingState.state'), 'ready');
  const m = html(page);
  assert.match(m, /Updated 12 min ago · next check \d{1,2}:00 [AP]M/);
  const card = (id) => (m.match(new RegExp(`data-focus-key="ship-kpi-${id}"[\\s\\S]*?<span class="kpi-value[^"]*">([^<]*)<`)) || [])[1];
  assert.deepEqual(['transit', 'out', 'delivered', 'exception', 'customs'].map(card), ['1', '1', '1', '1', '1']);
  // Tips carry the full numbers.
  assert.match(m, /data-tip="Out for delivery: 1 shipment on a FedEx vehicle for delivery today, worth \$20,000; click to list only these\."/);
  // No FedEx keys on this site: Refresh now explains why instead of calling.
  assert.match(m, /data-focus-key="ship-refresh"[^>]*aria-disabled="true"[^>]*data-tip="Refresh now needs the FedEx keys/);
  assert.deepEqual(page.errors, []);
});

test('progress strip: filled to the current stage, exception and clearance-delay marks, customs step skipped at home', async () => {
  const page = await hostedPage(await hostedSite());
  assert.deepEqual(strip(page, N.parcel), ['done', 'done', 'current', 'todo skip', 'todo', 'todo']);
  assert.deepEqual(strip(page, N.freight), ['done', 'done', 'done', 'done skip', 'current', 'todo']);
  assert.deepEqual(strip(page, N.customsDelay), ['done', 'done', 'done', 'current exception', 'todo', 'todo']);
  assert.deepEqual(strip(page, N.exception), ['done', 'done', 'done', 'done skip', 'current exception', 'todo']);
  assert.deepEqual(strip(page, N.delivered), ['done', 'done', 'done', 'done', 'done', 'current']);
  const m = html(page);
  assert.match(m, /Step 4 of 6: Customs, with a problem\./);
  assert.match(m, /<span class="status-chip bad">Clearance delay<\/span>/);
  assert.match(m, /<span class="status-chip bad">Exception<\/span>/);
  assert.match(m, /<span class="status-chip good">Delivered<\/span>/);
  // Problems first in the list.
  assert.deepEqual(listed(page).slice(0, 2), [N.exception, N.customsDelay]);
});

test('ETA against the promised date: "2 days late", delivered a day late, on time', async () => {
  const page = await hostedPage(await hostedSite());
  const m = html(page);
  const etaOf = (n) => (m.slice(m.indexOf(`data-focus-key="ship-${n}"`)).match(/class="ship-eta ([^"]*)">([^<]*)</) || []).slice(1);
  assert.deepEqual(etaOf(N.parcel), ['crit-text', 'ETA Oct 12 · 2 days late']);
  assert.deepEqual(etaOf(N.delivered), ['crit-text', 'Delivered Oct 8 · 1 day late']);
  assert.deepEqual(etaOf(N.freight), ['good-text', 'ETA Oct 9 · on time']);
  assert.deepEqual(etaOf(N.exception), ['', 'No ETA while the exception is open']);
});

test('clicking a shipment (or Enter on it) opens its delivery lines, last scan and customs scans', async () => {
  const page = await hostedPage(await hostedSite());
  page.run(`toggleShipment('${N.parcel}')`);
  let m = html(page);
  assert.match(m, new RegExp(`data-focus-key="ship-${N.parcel}" aria-expanded="true" aria-controls="ship-detail-${N.parcel}"`));
  const detail = m.slice(m.indexOf(`id="ship-detail-${N.parcel}"`));
  assert.match(detail, /Arrived at FedEx location · Regina, SK, CA/);
  assert.match(detail, /<span class="m">SPY-100<\/span>/);
  assert.match(detail, /<span class="m">SPY-101<\/span>/);
  assert.match(detail, /href="https:\/\/www\.fedex\.com\/fedextrack\/\?trknbr=770012345678" target="_blank" rel="noopener noreferrer"/);
  page.run(`toggleShipment('${N.customsDelay}')`);
  m = html(page);
  assert.match(m, /Missing commercial invoice — The shipper must send the commercial invoice/);
  assert.match(m, /<strong>Customs scans<\/strong><ol class="ship-customs"><li>In clearance process/);
  page.run(`toggleShipment('${N.parcel}')`);
  assert.match(html(page), new RegExp(`data-focus-key="ship-${N.parcel}" aria-expanded="false"`));
});

test('cross-border: ship-to outside Canada or customs scans, with clearance state and days in customs', async () => {
  const page = await hostedPage(await hostedSite());
  assert.deepEqual(page.run('shippingModel().cross.map(s=>s.number)').sort(), [N.customsDelay, N.delivered].sort());
  const m = html(page);
  const cross = m.slice(m.indexOf('class="data-table ship-cross"'));
  assert.match(cross, new RegExp(`${N.customsDelay}<\\/button><\\/td><td>Acme Marine USA<\\/td><td class="soft">United States \\(US\\)<\\/td><td><span class="status-chip bad">Clearance delay<\\/span><\\/td><td class="num">\\d+ days?<\\/td>`));
  assert.match(cross, /<span class="status-chip good">Released<\/span><\/td><td class="num">(under 1 day|1 day)<\/td>/);
  // Customs scans make any shipment cross-border; a US-to-US shipment is not.
  const cb = (country, st) => page.run(`shippingDecorate({number:'X',rows:[],names:new Set(),orders:new Set(),deliveries:new Set(),country:'${country}',value:0},${JSON.stringify(st)},Date.now()).crossBorder`);
  assert.equal(cb('CA', { stage: 'inTransit', reached: 'inTransit', customs: [{ at: '2026-10-05T10:00:00Z', desc: 'International shipment release - Import' }], customsState: 'released' }), true);
  assert.equal(cb('CA', { stage: 'inTransit', reached: 'inTransit', customs: [], customsState: '' }), false);
  assert.equal(cb('US', { stage: 'inTransit', reached: 'inTransit', customs: [], customsState: '', originCountry: 'US' }), false);
  assert.equal(cb('', { stage: 'inTransit', reached: 'inTransit', customs: [], customsState: '', destCountry: 'MX' }), true);
  // Opening one from the table expands it in the list above.
  page.run(`openShipment('${N.delivered}')`);
  assert.equal(page.run(`shippingExpanded.has('${N.delivered}')`), true);
});

test('cards filter the list; clicking again shows every shipment', async () => {
  const page = await hostedPage(await hostedSite());
  page.run("setShippingFilter('exception')");
  let m = html(page);
  assert.match(m, /data-focus-key="ship-kpi-exception" aria-pressed="true"/);
  assert.deepEqual([...m.matchAll(/class="ship-num">([^<]+)</g)].map((x) => x[1]), [N.exception]);
  page.run("setShippingFilter('exception')");
  m = html(page);
  assert.equal([...m.matchAll(/class="ship-num">([^<]+)</g)].length, 6);
});

test('the tracking list sent to the server: recent deliveries not delivered more than 7 days ago, plus hand-added numbers', async () => {
  const site = await hostedSite();
  const page = await hostedPage(site);
  await page.run('shippingSync()');
  const { WANTED_KEY } = await modules();
  const wanted = site.kv.json(WANTED_KEY);
  assert.equal(wanted.exportAsOf, '2026-10-08');
  // Newest shipment first; the August delivery (outside 30 days), the long-delivered one and the PO receipt are left out.
  assert.deepEqual(wanted.export, [N.freight, N.exception, N.parcel, N.customsDelay, N.delivered]);
  assert.deepEqual(wanted.manual, []);
  assert.ok(site.calls.includes('PUT /api/shipping'));
  // Nothing changed: no second PUT.
  const puts = site.calls.filter((c) => c === 'PUT /api/shipping').length;
  await page.run('shippingSync()');
  assert.equal(site.calls.filter((c) => c === 'PUT /api/shipping').length, puts);
  // A number added by hand joins the list.
  field(page, 'ship-add-number').value = '7700 2222 3333';
  field(page, 'ship-add-order').value = '600';
  page.run('shippingAddManual()');
  await page.run('shippingSync()');
  assert.deepEqual(site.kv.json(WANTED_KEY).manual, ['770022223333']);
});

test('a future export date stored on the server (never a real export) does not stop this export from being sent', async () => {
  const site = await hostedSite();
  const { WANTED_KEY } = await modules();
  await site.kv.put(WANTED_KEY, JSON.stringify({ v: 1, exportAsOf: '9999-12-31', export: [], manual: [] }));
  const page = await hostedPage(site);
  await page.run('shippingSync()');
  const wanted = site.kv.json(WANTED_KEY);
  assert.equal(wanted.exportAsOf, '2026-10-08');
  assert.equal(wanted.export.length, 5);
});

test('one TrackNo field with several numbers: commas, &, + or "and", or two whole numbers with a space between', async () => {
  const page = loadPage({ today: TODAY });
  const split = (v) => page.run(`shipSplit(${JSON.stringify(v)})`);
  assert.deepEqual(split('770012345678 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(split('770012345678 & 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(split('770012345678 and 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(split('7700 1234 5678, 7700-1234-5679 + 1234567890'), ['770012345678', '770012345679', '1234567890']);
  assert.deepEqual(split('7700 1234 5678'), ['770012345678'], 'grouped digits are one number');
  // Same rule as the server (shared/fedex.mjs splitTrackingNumbers).
  const { splitTrackingNumbers } = await modules();
  for (const v of ['770012345678 770012345679', '7700 1234 5678 and 7700 1234 5679', 'a & b', '1234567890 + 7700-1234-5678', ' SANDBOX123 ']) assert.deepEqual(split(v), splitTrackingNumbers(v), v);
  // A delivery row keeps both numbers, so both are tracked.
  const two = loadPage({ today: TODAY });
  await upload(two, [exportFile([delivery({ DocumentNumber: '700', DeliveryDocNumber: '9700', ShipDate: '10/06/2026', TrackingNumber: '770012345678 770012345679', ...due('10/10/2026') })])]);
  assert.deepEqual(listed(two).sort(), ['770012345678', '770012345679']);
});

test('other carriers (UPS, Purolator…) and words in TrackNo are not FedEx shipments; two numbers share the delivery value', async () => {
  const page = loadPage({ today: TODAY });
  const d = (doc, method, track, o = {}) => delivery({ DocumentNumber: doc, DeliveryDocNumber: `9${doc}`, ShipMethod: method, TrackingNumber: track, ShipDate: '10/06/2026', ...due('10/10/2026'), ...o });
  await upload(page, [exportFile([
    d('710', 'UPS Standard', '1Z999AA10123456784'),
    d('711', 'Purolator Ground', '335123456789'),
    d('712', 'FedEx Ground', '770033334444'),
    d('713', '', '770055556666'),
    d('714', 'Customer pickup - prepaid', 'Customer Pickup'),
    d('715', 'FedEx Ground', '770012345678, 770012345679', { AmountLocal: '1,000.00' }),
    d('716', '', '1Z999AA10123456785'), // a UPS number with no ship method
    d('717', 'Canpar', '335123456790', { ShipDate: '07/01/2026' }), // outside the 30 days: not counted
  ])]);
  const want = ['770012345678', '770012345679', '770033334444', '770055556666'];
  assert.deepEqual(listed(page).sort(), want);
  assert.deepEqual(page.run('shippingWantedLists(shippingModel()).export').sort(), want, 'never sent to FedEx');
  assert.equal(page.run('shippingModel().otherCarrier'), 3);
  page.run("setTab('shipping')");
  assert.match(html(page), /3 tracking numbers from the last 30 days are another carrier’s \(UPS, Purolator…\) and not listed\./);
  assert.doesNotMatch(html(page), /1Z999AA|335123456789|CUSTOMERPICKUP/);
  // The two parcels of delivery 9715 share its $1,000, so a card total counts the delivery once.
  assert.deepEqual(page.run("shippingModel().list.filter(s=>s.number.startsWith('77001234567')).map(s=>s.value)"), [500, 500]);
  assert.deepEqual(page.run("['FedEx Express','FDX Ground','UPS Standard','Customer pickup - prepaid',''].map(m=>shipOtherCarrier('770012345678',m))"), [false, false, true, false, false]);
  assert.equal(page.run("shipClean('Will Call')"), '');
});

test('hand-added numbers on the server are not wiped by a browser whose shared notes have not arrived yet', async () => {
  const site = await hostedSite();
  const { WANTED_KEY } = await modules();
  await site.kv.put(WANTED_KEY, JSON.stringify({ v: 1, exportAsOf: '2026-10-01', export: [N.old], manual: ['1234567891'] }));
  const page = await hostedPage(site);
  await page.run('shippingSync()');
  const wanted = site.kv.json(WANTED_KEY);
  assert.deepEqual(wanted.manual, ['1234567891']);
  assert.equal(wanted.exportAsOf, '2026-10-08', 'the newer export replaces the older export list');
  assert.equal(wanted.export.length, 5);
});

test('Add tracking #: saved in this browser when there is no server (the shared notes store keeps it locally), linked to its order, searchable, removable', async () => {
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile()]);
  page.run("setTab('shipping')");
  field(page, 'ship-add-number').value = 'nope';
  page.run('shippingAddManual()');
  assert.match(field(page, 'ship-add-status').textContent, /Type a FedEx tracking number/);
  field(page, 'ship-add-number').value = '7700 2222 3333';
  field(page, 'ship-add-order').value = 'SO 600';
  page.run('shippingAddManual()');
  const saved = JSON.parse(page.storage.spyderKpiShipmentsV1);
  assert.deepEqual(Object.keys(saved), ['770022223333']);
  assert.equal(saved['770022223333'].order, '600');
  // Announced once, by the dashboard's toast (Stream A), not also by the status line.
  assert.match(page.els.toast.innerHTML, /Tracking # 770022223333 added to order 600/);
  assert.equal(field(page, 'ship-add-status').textContent, '');
  page.run("toggleShipment('770022223333')");
  const m = html(page);
  assert.match(m, /class="ship-num">770022223333<\/span><span class="ship-sub">FedEx · Firefly RV · SO 600 · added by hand</);
  assert.match(m.slice(m.indexOf('id="ship-detail-770022223333"')), /<td class="strong">600<\/td>/);
  // Search finds the order line by the hand-added number.
  page.run("onGlobalSearchInput('770022223333');applyGlobalSearch()");
  assert.deepEqual(page.run('globalSearchResults(currentMetrics()).rows.map(x=>[searchRowType(x.r),x.r.documentNumber])'), [['Sales order', '600']]);
  assert.match(html(page), /Tracking <mark>770022223333<\/mark>/);
  page.run("clearGlobalSearch();setTab('shipping');shippingRemoveManual('770022223333')");
  assert.equal(JSON.parse(page.storage.spyderKpiShipmentsV1)['770022223333'].deleted, true);
  assert.ok(!listed(page).includes('770022223333'));
});

// The hosted site with both Pages Functions over one KV namespace: /api/shipping (Stream E) and /api/notes (Stream B,
// which keeps the hand-added numbers in the 'overrides' document under shipments:{[number]:{number,order,by,at}}),
// plus /api/people (the editor names, sent once a day when the page opens).
async function hostedSiteWithNotes() {
  const site = await hostedSite();
  const fns = { '/api/notes': (await import('../functions/api/notes.js')).onRequest, '/api/people': (await import('../functions/api/people.js')).onRequest };
  const shipping = site.fetch;
  site.fetch = async (url, init = {}) => {
    if (!fns[url]) return shipping(url, init);
    site.calls.push(`${init.method || 'GET'} ${url}`);
    return fns[url]({ request: new Request(ORIGIN + url, { ...init, headers: { ...(init.headers || {}), Origin: ORIGIN } }), env: site.env, params: {} });
  };
  return site;
}
async function notesBrowser(site, name, today = TODAY) {
  const page = loadPage({ today, storage: { spyderKpiEditorName: name } });
  Object.assign(page.ctx, { fetch: site.fetch, location: { href: ORIGIN + '/', protocol: 'https:' } });
  await upload(page, [exportFile()]);
  await page.ctx.syncSharedNotes();
  page.run("setTab('shipping')");
  await settle(page);
  return page;
}

test('Add tracking # round-trips through the shared notes store (/api/notes): every browser that signs in sees it, and a removal reaches them too', async () => {
  const site = await hostedSiteWithNotes();
  // Page clocks are pinned; both days are in the past so /api/notes keeps each edit's own time (it moves a time ahead
  // of the server's clock back to now), and the second browser's edit is the newer one.
  const a = await notesBrowser(site, 'Kareena', '2026-10-07');
  assert.equal(a.run('sharedNotes.state'), 'shared');
  assert.match(html(a), /shared with everyone/);
  field(a, 'ship-add-number').value = '1234 5678 91';
  field(a, 'ship-add-order').value = 'SO 600';
  a.run('shippingAddManual()');
  // Announced once, by the dashboard's toast (not also by the status line).
  assert.match(a.els.toast.innerHTML, /Tracking # 1234567891 added to order 600\. Its FedEx status shows after the next check/);
  assert.equal(field(a, 'ship-add-status').textContent, '');
  await a.run('flushSharedNotes({all:true})');
  const stored = site.kv.json('overrides');
  assert.deepEqual(Object.keys(stored.shipments), ['1234567891']);
  const entry = stored.shipments['1234567891'];
  assert.equal(entry.number, '1234567891');
  assert.equal(entry.order, '600');
  assert.equal(entry.by, 'Kareena');
  assert.ok(Date.parse(entry.at) > 0);
  assert.equal(entry.deleted, undefined);

  // A second browser (its own storage, the next day) gets it from the server, with its order lines.
  const b = await notesBrowser(site, 'Jamie Cole', '2026-10-08');
  assert.ok(listed(b).includes('1234567891'), 'the other browser lists the number');
  assert.match(html(b), /class="ship-num">1234567891<\/span><span class="ship-sub">[^<]*SO 600 · added by hand</);
  await b.run('shippingSync()');
  assert.ok(site.kv.json((await modules()).WANTED_KEY).manual.includes('1234567891'), 'the FedEx tracking list carries it');

  // Removed in the second browser: gone on the server and, after a refresh, in the first.
  b.run("shippingRemoveManual('1234567891')");
  await b.run('flushSharedNotes({all:true})');
  assert.equal(site.kv.json('overrides').shipments['1234567891'].deleted, true);
  a.run('sharedNotes.syncedAt=0');
  await a.ctx.syncSharedNotes();
  a.run('renderResults()');
  assert.ok(!listed(a).includes('1234567891'));
  assert.deepEqual([...a.errors, ...b.errors], []);
});

test('Shipping has a first-visit hint (Stream A hints): dismissed once per browser, back with Show hints again, never in a snapshot', async () => {
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile()]);
  page.run("setTab('shipping')");
  assert.match(html(page), /<div class="hint-card print-hide" role="note" aria-label="Hint" data-hint="shipping">[\s\S]*?Add tracking #/);
  page.run("dismissHint('shipping');renderResults()");
  assert.doesNotMatch(html(page), /data-hint="shipping"/);
  assert.ok(JSON.parse(page.storage.spyderKpiHints).shipping);
  page.run('resetHints()');
  assert.match(html(page), /data-hint="shipping"/);
  page.run('isSnapshotView=true;renderResults()');
  assert.doesNotMatch(html(page), /data-hint="shipping"/);
});

test('search covers export tracking numbers, typed with or without spaces', async () => {
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile()]);
  const search = (q) => { page.run(`onGlobalSearchInput(${JSON.stringify(q)});applyGlobalSearch()`); return page.run('globalSearchResults(currentMetrics()).rows.map(x=>[searchRowType(x.r),x.r.documentNumber,x.r.itemCode])'); };
  assert.deepEqual(search('770012345678'), [['Delivery', '600', 'SPY-100'], ['Delivery', '600', 'SPY-101']]);
  assert.deepEqual(search('7700 1234 5678'), [['Delivery', '600', 'SPY-100'], ['Delivery', '600', 'SPY-101']]);
  assert.match(html(page), /Tracking <mark>7700<\/mark><mark>1234<\/mark><mark>5678<\/mark>/);
  assert.deepEqual(search(N.freight), [['Delivery', '602', 'SPY-100']]);
});

test('Refresh now asks the server, shows the new statuses, and explains the 10-minute limit', async () => {
  const { fakeFedex } = await modules();
  const site = await hostedSite({ fedexKeys: true, statuses: {} });
  const fx = fakeFedex();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fx.fetch; // the server's calls to FedEx
  try {
    const page = await hostedPage(site);
    assert.match(html(page), /data-focus-key="ship-refresh"[^>]*data-tip="Ask FedEx now/);
    await page.run('shippingRefresh()');
    assert.ok(site.calls.includes('POST /api/shipping'));
    assert.equal(page.run(`shippingState.statuses['${N.customsDelay}'].customsState`), 'delay');
    assert.match(html(page), /FedEx checked just now: 6 tracking numbers up to date\./);
    assert.match(page.els.toast.innerHTML, /<span>FedEx checked just now: 6 tracking numbers up to date\.<\/span>/, 'a check that worked is confirmed in a toast');
    assert.ok(page.run('shippingState.refreshAfter'), 'the server says when Refresh works again');
    page.run("shippingState.refreshAfter=new Date(Date.now()+5*60000).toISOString();renderResults()");
    assert.match(html(page), /data-focus-key="ship-refresh"[^>]*aria-disabled="true"[^>]*data-tip="Refresh now was used recently/);
    page.run('shippingRefresh()');
    assert.match(html(page), /Refresh works again at/);
    // Once allowed again the server still limits it to one check per 10 minutes for everyone.
    page.run("shippingState.refreshAfter=''");
    page.els.toast.innerHTML = '';
    await page.run('shippingRefresh()');
    assert.match(html(page), /less than 10 minutes ago/);
    assert.equal(page.els.toast.innerHTML, '', 'a refused Refresh is told in the page note, never in the green-tick toast');
    assert.ok(!page.run('JSON.stringify([shippingState.statuses,shippingState.notice,shippingState.wanted,document.getElementById("results-screen").innerHTML])').includes('super-secret-key'));
  } finally { globalThis.fetch = realFetch; }
});

test('a server error page is an error to retry, not "needs the hosted dashboard"; a failed Refresh says when it works again', async () => {
  const page = loadPage({ today: TODAY });
  Object.assign(page.ctx, { fetch: async () => new Response('<!doctype html><title>Error 1101</title>', { status: 500, headers: { 'content-type': 'text/html' } }), location: { href: ORIGIN + '/', protocol: 'https:' } });
  await upload(page, [exportFile()]);
  page.run("setTab('shipping')");
  await settle(page);
  assert.equal(page.run('shippingState.state'), 'error');
  assert.doesNotMatch(html(page), /Live FedEx tracking needs the hosted dashboard/);
  assert.match(page.run('shippingState.notice'), /The server answered 500/);

  const { fakeFedex } = await modules();
  const site = await hostedSite({ fedexKeys: true });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFedex({ tokenStatus: 401 }).fetch; // the FedEx keys are wrong
  try {
    const hosted = await hostedPage(site);
    hosted.els.toast.innerHTML = '';
    await hosted.run('shippingRefresh()');
    assert.match(hosted.run('shippingState.notice'), /refused the API key/);
    assert.equal(hosted.els.toast.innerHTML, '', 'no success toast for a failed Refresh');
    const after = Date.parse(hosted.run('shippingState.refreshAfter'));
    assert.ok(after > Date.now() + 50000 && after < Date.now() + 70000, 'Refresh works again in about a minute');
    hosted.run(`Date.now=()=>${Date.now()};renderResults()`); // the page's clock is pinned to the export day; use the server's
    assert.match(html(hosted), /data-focus-key="ship-refresh"[^>]*aria-disabled="true"[^>]*data-tip="Refresh now was used recently\. Refresh works again at [^"]*1 minute after a try that failed/);
  } finally { globalThis.fetch = realFetch; }
});

test('a shared snapshot keeps the statuses on screen and never calls the server', async () => {
  const page = await hostedPage(await hostedSite());
  let payload = '';
  Object.assign(page.ctx, { buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  await page.ctx.exportShareSnapshot();
  const data = JSON.parse(payload);
  assert.equal(data.activeTab, 'shipping');
  assert.equal(data.shipping.statuses[N.exception].stage, 'exception');

  const snap = loadPage({ today: '2026-10-20' });
  const calls = [];
  Object.assign(snap.ctx, { fetch: async (u) => { calls.push(u); throw new Error('no network'); }, location: { href: 'file:///snap.html', protocol: 'file:' } });
  snap.els['embedded-snapshot-data'].dataset.encoding = 'json';
  snap.els['embedded-snapshot-data'].textContent = payload;
  await snap.run('loadEmbeddedSnapshot()');
  const m = html(snap);
  assert.equal(snap.run('shippingState.state'), 'snapshot');
  assert.match(m, /FedEx statuses as of .* \(shared snapshot\)/);
  assert.match(m, /<span class="status-chip bad">Clearance delay<\/span>/);
  assert.doesNotMatch(m, /ship-add-number|data-focus-key="ship-refresh"/);
  assert.deepEqual(calls, []);
});

test('every card, button, column header and shipment row on the page has a plain-English tooltip; markup is balanced', async () => {
  const page = await hostedPage(await hostedSite());
  page.run(`toggleShipment('${N.customsDelay}')`);
  const m = html(page);
  const start = m.indexOf('class="ship-bar');
  const own = m.slice(start);
  for (const tag of own.match(/<(button|th|a)\b[^>]*>/g)) assert.match(tag, /data-tip="[^"]{12,}"/, tag);
  const kpis = own.match(/<[a-z]+ [^>]*class="(?:[^"]*\s)?kpi(?:\s[^"]*)?"[^>]*>/g);
  assert.equal(kpis.length, 5);
  for (const tag of kpis) assert.match(tag, /data-tip="/, tag);
  // The sidebar link gets its tip from PAGE_TIPS like every other page (Stream A): a tooltip on the results screen.
  assert.match(page.els['app-sidebar'].innerHTML, /<button [^>]*data-focus-key="nav-shipping"[^>]*data-tip="Live FedEx tracking for recent deliveries[^"]*"/);
  assert.doesNotMatch(m.replace(/<[^>]+>/g, ' '), /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]/);
  const count = (needle) => m.split(needle).length - 1;
  for (const tag of ['div', 'table', 'tr', 'td', 'section', 'button', 'span', 'form', 'label', 'details', 'ol', 'li', 'p']) {
    assert.equal(count(`<${tag} `) + count(`<${tag}>`) + count(`<${tag}\n`), count(`</${tag}>`), `unbalanced <${tag}>`);
  }
  assert.deepEqual(page.errors, []);
});

test('SAP text cannot inject markup into the Shipping page', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile([delivery({ DocumentNumber: '700', CustomerVendorName: evil, ShipMethod: evil, ShipToCountry: '<b>', DeliveryDocNumber: '9100', TrackingNumber: `${N.parcel}, ${evil}`, ShipDate: '10/06/2026', 'Item No.': evil })])]);
  page.run(`setTab('shipping');toggleShipment('${N.parcel}')`);
  assert.doesNotMatch(html(page), /<img src=x/);
  assert.deepEqual(listed(page), [N.parcel]);
});

run();
