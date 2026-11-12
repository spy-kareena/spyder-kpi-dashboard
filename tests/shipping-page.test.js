// The Shipping page (index.html), 2v6.8: shipments from SAP deliveries (any carrier) and numbers added by hand;
// statuses from AfterShip (read from /api/shipping, which the scheduled Worker fills every 2 hours) with a hand-set
// status (Shipped / In transit / Delayed / Delivered + date + note, saved through the shared notes store) as an
// override when it is newer; cards and the progress strip from those statuses; an external-link icon per row to
// AfterShip's public tracking page; search; snapshots; no demo data.
// Run: node tests/shipping-page.test.js. Fixtures are synthetic (harness.js); /api/notes and /api/shipping are the real
// Pages Functions over a Workers KV stand-in, so nothing leaves the machine.
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
const card = (page, id) => (html(page).match(new RegExp(`data-focus-key="ship-kpi-${id}"[\\s\\S]*?<span class="shp-tile-v"[^>]*>([^<]*)<`)) || [])[1];
const cards = (page) => ['transit', 'delayed', 'delivered', 'stale'].map((id) => card(page, id));
const status = (page, n) => page.run(`(()=>{const s=shippingModel().list.find(x=>x.number==='${n}');return [s.status,s.mark&&s.mark.source||'']})()`);
// One shipment's row: its head button (strip, status text, ETA) and its open details, if open.
function rowOf(page, number) {
  const m = html(page);
  const at = m.indexOf(`data-focus-key="ship-${number}"`);
  assert.ok(at > 0, `row ${number} is listed`);
  const end = m.indexOf('<div class="shp-row', at);
  return m.slice(at, end < 0 ? undefined : end);
}
// The strip: how many of its three steps are filled, and its tone (red = delayed, teal = delivered).
function strip(page, number) {
  const head = rowOf(page, number);
  const h = head.slice(0, head.indexOf('</button>'));
  return [(h.match(/dz-prog-fill/g) || []).length, (h.match(/class="dz-prog( (red|teal))?"/) || [])[2] || ''];
}
const stateText = (page, number) => (rowOf(page, number).match(/<span class="shp-st[^"]*">([^<]*)</) || [])[1];
const etaText = (page, number) => (rowOf(page, number).match(/<span class="shp-eta"><b[^>]*>([^<]*)<\/b><em[^>]*>([^<]*)</) || []).slice(1);
const factOf = (page, number, label) => (rowOf(page, number).match(new RegExp(`<span>${label}</span><strong>([^<]*)</strong>`)) || [])[1];
const tick = () => new Promise((r) => setTimeout(r, 30));
async function settle() { for (let i = 0; i < 4; i++) await tick(); }
// A page with the export loaded, on the Shipping page (a file copy: no /api/shipping).
async function shipPage({ storage = {}, files = [exportFile()], today = TODAY } = {}) {
  const page = loadPage({ today, storage });
  await upload(page, files);
  page.run("setTab('shipping')");
  return page;
}
// Fills in a shipment's status form (it must be open) and submits it.
function setStatus(page, number, st, date = '', note = '') {
  if (!page.run(`shippingExpanded.has('${number}')`)) page.run(`toggleShipment('${number}')`);
  field(page, `ship-st-${number}`).value = st;
  field(page, `ship-sd-${number}`).value = date;
  field(page, `ship-sn-${number}`).value = note;
  page.run(`shippingStatusSubmit(null,'${number}')`);
}

// AfterShip results as the Worker saves them (shared/aftership.mjs normalizeTracking).
const TAG = { shipped: 'InfoReceived', transit: 'InTransit', delayed: 'Exception', delivered: 'Delivered' };
const asStatus = (number, state, o = {}) => ({
  number, id: `as-${number}`, slug: 'fedex', carrier: 'FedEx', tag: TAG[state], subtag: '', status: { shipped: 'Label created', transit: 'In transit', delayed: 'Exception', delivered: 'Delivered' }[state],
  detail: '', state, stage: '', lastEvent: null, eta: '', deliveredAt: '', shippedAt: '', originCountry: '', destCountry: '', changedAt: '', updatedAt: '',
  notFound: false, error: '', checkedAt: '2026-10-09T08:00:00.000Z', ...o,
});
const AS = {
  [N.parcel]: asStatus(N.parcel, 'transit', { changedAt: '2026-10-08T12:10:00.000Z', eta: '2026-10-12T17:00:00-05:00', lastEvent: { at: '2026-10-08T06:10:00-06:00', city: 'Regina, SK, CAN', desc: 'Arrived at FedEx location' } }),
  [N.ups]: asStatus(N.ups, 'delayed', { slug: 'ups', carrier: 'UPS', detail: 'Customs clearance delay', changedAt: '2026-10-08T18:00:00.000Z', lastEvent: { at: '2026-10-08T14:00:00-04:00', city: 'Blaine, WA, US', desc: 'Clearance delay: commercial invoice missing' } }),
  [N.delivered]: asStatus(N.delivered, 'delivered', { deliveredAt: '2026-10-08T10:12:00-04:00', changedAt: '2026-10-08T14:12:00.000Z', lastEvent: { at: '2026-10-08T10:12:00-04:00', city: 'Columbus, OH, USA', desc: 'Delivered' } }),
  [N.freight]: asStatus(N.freight, 'shipped', { slug: 'fedex-freight', carrier: 'FedEx Freight', tag: 'Pending', status: 'Pending' }),
  [N.usa]: asStatus(N.usa, 'transit', { changedAt: '2026-10-05T10:00:00.000Z', lastEvent: { at: '2026-10-05T04:00:00-06:00', city: 'Calgary, AB, CAN', desc: 'Departed FedEx hub' } }),
};
// Read by the Worker two hours before the page's pinned clock (TODAY 10:00 local), whatever the time zone.
const POLLED_AT = new Date(new Date(`${TODAY}T10:00:00`).getTime() - 2 * 3600e3).toISOString();
const INDEX = { v: 2, provider: 'aftership', polledAt: POLLED_AT, source: 'cron', count: 6, polled: 5, created: 0, waiting: 0, statuses: AS, errors: [] };

test('delivery rows read TrackingNumber, ShipMethod, ShipToCountry and ShipDate; an export without them loads as before', async () => {
  const page = loadPage({ today: TODAY });
  await upload(page, [exportFile()]);
  const d = page.run(`allLoadedRows.find(r=>r.deliveryDocNumber==='9002')`);
  assert.deepEqual([d.trackingNumber, d.shipMethod, d.shipToCountry, page.run(`displayDate(allLoadedRows.find(r=>r.deliveryDocNumber==='9002').shipDate)`)], [N.usa, 'FedEx International Priority', 'US', '2026-10-05']);
  assert.equal(page.run(`displayDate(allLoadedRows.find(r=>r.deliveryDocNumber==='9002').lineDueDate)`), '2026-10-08');

  const old = loadPage({ today: TODAY });
  await upload(old, [{ name: 'old.xls', bytes: utf16Tsv(OLD_HEADERS, [sapRow({}), sapRow({ DocumentNumber: '3', OrderType: 'Sales Delivery', Status: 'Closed', ClosedDate: '08/28/2026', CloseDateSource: 'Delivery', DeliveryDocNumber: '77', OpenQuantity: '0' })]) }]);
  assert.deepEqual(old.run('allLoadedRows.map(r=>[r.trackingNumber,r.shipMethod,r.shipToCountry,r.shipDate])'), [['', '', '', ''], ['', '', '', '']]);
  old.run("setTab('shipping')");
  assert.match(html(old), /This export has no TrackingNumber column/);
  assert.match(html(old), /No tracking numbers on deliveries shipped in the 30 days to 2026-09-03/);
  // With no shipments the page shows its one empty card (no demo shipments any more).
  assert.match(html(old), /<h2 class="shp-empty-t">No shipments to show<\/h2>/);
  assert.deepEqual(old.errors, []);
});

test('every carrier is listed: sales deliveries shipped in the 30 days to the export date, numbers cleaned, receipts left out', async () => {
  const page = await shipPage();
  assert.deepEqual(listed(page).sort(), [...REAL].sort());
  const s = page.run(`(()=>{const s=shippingModel().list.find(x=>x.number==='${N.parcel}');return {rows:s.rows.length,orders:[...s.orders],deliveries:[...s.deliveries],value:s.value,method:s.shipMethod,ship:displayDate(s.shipDate),promised:displayDate(s.promised)}})()`);
  assert.deepEqual(s, { rows: 2, orders: ['600'], deliveries: ['9001'], value: 1500, method: 'FedEx Ground', ship: '2026-10-06', promised: '2026-10-10' });
  const carrier = (n) => page.run(`shipCarrier(shippingModel().list.find(x=>x.number==='${n}'))`);
  assert.deepEqual([N.parcel, N.freight, N.ups, N.puro].map(carrier), ['FedEx', 'FedEx Freight', 'UPS', 'Purolator']);
  assert.equal(page.run("shipCarrier({number:'1Z999AA10123456785',shipMethod:''})"), 'UPS');
  assert.equal(page.run("shipCarrier({number:'123456789',shipMethod:''})"), 'Carrier not set');
  assert.equal(page.run("shipCarrier({number:'123456789',shipMethod:'Customer truck',as:{carrier:'Canpar'}})"), 'Canpar', 'AfterShip names the carrier the ship method does not');
  const m = html(page);
  assert.match(m, /<h1 class="dz-h1"[^>]*>Shipping<\/h1>/);
  // The page meta is quiet: how many shipments (no AfterShip here), no as-of clutter.
  assert.equal(page.run('shippingHeadMeta()'), '6 shipments');
  assert.match(m, /<span class="page-meta"[^>]*>6 shipments<\/span>/);
});

test('each row has an external-link icon (not a Check button) that opens the AfterShip tracking page in a new tab', async () => {
  const page = await shipPage();
  let m = html(page);
  for (const n of REAL) {
    assert.match(m, new RegExp(`<a class="dz-btn shp-open" href="https://www\\.aftership\\.com/track/${n}" target="_blank" rel="noopener" data-focus-key="ship-open-${n}" aria-label="Open tracking page" data-tip="Open tracking page"><svg [^>]*aria-hidden="true"[^>]*><path d="M14 4h6v6"/>`));
  }
  assert.doesNotMatch(m, />Check<|shp-check|renderShipCheck/);
  assert.equal(page.run('typeof renderShipCheck'), 'undefined');
  // Never inside the row's button (a link in a button is invalid markup).
  for (const [head] of m.matchAll(/<button type="button" class="shp-head"[\s\S]*?<\/button>/g)) assert.doesNotMatch(head, /<a /);
  page.run(`toggleShipment('${N.ups}')`);
  m = html(page);
  assert.match(m.slice(m.indexOf(`id="ship-detail-${N.ups}"`)), new RegExp(`<a class="dz-btn shp-open-t" href="https://www\\.aftership\\.com/track/${N.ups}" target="_blank" rel="noopener"[^>]*>[\\s\\S]*?Open tracking page</a>`));
  assert.equal(page.run("shipTrackUrl('A B/1')"), 'https://www.aftership.com/track/A%20B%2F1');
  // The CSS: the icon is a 30px round button in its own marker block.
  const css = page.ctx.document.documentElement.outerHTML;
  assert.match(css, /\/\* 2v8:ship \*\/[\s\S]*a\.dz-btn\.shp-open\{width:30px;height:30px;[\s\S]*\/\* 2v8:end ship \*\/\n\/\* 2v7:motion \*\//);
});

test('a file copy or a static host: no AfterShip, one short note, statuses by hand; the page never calls a carrier or AfterShip itself', async () => {
  const file = await shipPage();
  const note = /<p class="shp-note">Automatic tracking isn’t set up, so statuses are set by hand\.<\/p>/;
  assert.match(html(file), note);
  assert.equal((html(file).match(/Automatic tracking/g) || []).length, 1, 'said once');
  // A static web server: /api/shipping answers 404, so the note shows after the first read and nothing else is asked.
  const calls = [];
  const page = loadPage({ today: TODAY });
  Object.assign(page.ctx, { fetch: async (u, init = {}) => { calls.push(`${init.method || 'GET'} ${u}`); return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }); }, location: { href: 'http://intranet/', protocol: 'http:' } });
  await upload(page, [exportFile()]);
  page.run("setTab('shipping')");
  await settle();
  assert.match(html(page), note);
  assert.deepEqual(calls.filter((c) => /shipping|fedex|aftership|track/i.test(c)), ['GET /api/shipping'], 'one read, no list sent, no carrier site');
  page.run(`toggleShipment('${N.parcel}')`);
  page.run("setTab('weekly');setTab('shipping')");
  await settle();
  assert.equal(calls.filter((c) => /shipping/.test(c)).length, 1, 'not read again within 5 minutes');
  assert.deepEqual(page.errors, []);
});

test('hosted: reads /api/shipping on open, sends the list once, and AfterShip statuses drive the cards, strip, ETA and details', async () => {
  const site = await hostedSite({ index: INDEX });
  const page = await hostedBrowser(site, 'Pat');
  const reads = site.calls.filter((c) => c === 'GET /api/shipping');
  assert.equal(reads.length, 1);
  assert.deepEqual(site.calls.filter((c) => c === 'PUT /api/shipping').length, 1);
  // The list sent: export numbers newest first, with the carriers the ship methods name.
  const wanted = site.kv.json('tracking:wanted');
  assert.deepEqual(wanted.export, [N.freight, N.ups, N.parcel, N.usa, N.delivered, N.puro]);
  assert.deepEqual(wanted.carriers, { [N.freight]: 'FedEx Freight', [N.ups]: 'UPS', [N.parcel]: 'FedEx', [N.usa]: 'FedEx', [N.delivered]: 'FedEx', [N.puro]: 'Purolator' });
  assert.equal(wanted.exportAsOf, '2026-10-08');

  // In transit: parcel, usa (transit), freight (label created); Delayed: ups; Delivered this week: delivered;
  // No update in 2+ days: usa (last scan Oct 5) and puro (no AfterShip record, shipped Sep 15).
  assert.deepEqual(cards(page), ['3', '1', '1', '2']);
  assert.deepEqual(page.run('shippingModel().groups.stale.map(s=>s.number)').sort(), [N.usa, N.puro].sort());
  assert.deepEqual([strip(page, N.parcel), strip(page, N.ups), strip(page, N.delivered), strip(page, N.freight), strip(page, N.puro)], [[2, ''], [2, 'red'], [3, 'teal'], [1, ''], [1, '']]);
  assert.deepEqual([stateText(page, N.parcel), stateText(page, N.ups), stateText(page, N.puro)], ['In transit', 'Delayed', 'No status']);
  // ETA: AfterShip's expected date (Oct 12, past the promised Oct 10: late) over when it last changed.
  assert.equal(etaText(page, N.parcel)[0], 'Oct 12');
  assert.match(etaText(page, N.parcel)[1], /^Updated \d+ h ago$/);
  assert.deepEqual(etaText(page, N.delivered), ['Delivered Oct 8', 'promised Oct 7']);
  assert.match(rowOf(page, N.parcel), /<span class="shp-eta"><b class="late">Oct 12<\/b>/);
  assert.deepEqual(etaText(page, N.freight)[1], 'No update yet');
  // Details: the status, where it came from, AfterShip's words, the last scan and the expected date.
  page.run(`toggleShipment('${N.ups}')`);
  assert.equal(factOf(page, N.ups, 'Status'), 'Delayed · Oct 8');
  assert.equal(factOf(page, N.ups, 'Source'), 'From AfterShip');
  assert.equal(factOf(page, N.ups, 'AfterShip'), 'Exception · Customs clearance delay');
  assert.match(factOf(page, N.ups, 'Last scan'), /^Clearance delay: commercial invoice missing · Blaine, WA, US · Oct 8, 2:00 PM$/);
  assert.equal(page.run(`shipCarrier(shippingModel().list.find(x=>x.number==='${N.ups}'))`), 'UPS');
  // The Delayed list shows AfterShip's latest scan.
  assert.match(html(page), /class="shp-li exc" data-focus-key="ship-d-1Z999AA10123456784"[\s\S]*?<span class="shp-li-why">Clearance delay: commercial invoice missing<\/span>/);
  // The quiet meta: when AfterShip was last read and the next check (every 2 hours, even UTC hours).
  assert.match(page.run('shippingHeadMeta()'), /^Updated 8:00 AM · next \d{1,2}:\d{2} [AP]M$/);
  assert.doesNotMatch(html(page), /Automatic tracking isn’t set up/);
  // A second read with the same list sends nothing again.
  page.run('shpAs.at=0;shpAsLoad(true)');
  await settle();
  assert.equal(site.calls.filter((c) => c === 'PUT /api/shipping').length, 1);
  assert.ok(site.calls.every((c) => !/aftership\.com|fedex|ups\.com/i.test(c)));
  assert.deepEqual(page.errors, []);
});

test('a hand-set status newer than AfterShip\'s wins; an AfterShip update newer than the hand-set one wins; details say which', async () => {
  const site = await hostedSite({ index: INDEX });
  // An older hand-set Delayed on the parcel (Oct 7) is replaced by AfterShip's In transit (Oct 8).
  await site.kv.put('overrides', JSON.stringify({ v: 1, rows: {}, shipments: { [`st:${N.parcel}`]: { order: '600', number: N.parcel, status: 'delayed', statusDate: '2026-10-07', note: 'Old note', by: 'Sam', at: '2026-10-07T10:00:00.000Z' } }, savedAt: '' }));
  const page = await hostedBrowser(site, 'Pat');
  assert.deepEqual(status(page, N.parcel), ['transit', 'aftership']);
  // Pat checks the UPS one with the customs broker and sets In transit now (Oct 9): newer than AfterShip's Oct 8.
  setStatus(page, N.ups, 'transit', '2026-10-09', 'Broker cleared it');
  assert.deepEqual(status(page, N.ups), ['transit', 'hand']);
  assert.match(page.els.toast.innerHTML, /1Z999AA10123456784: In transit Oct 9 saved for everyone\./);
  assert.match(factOf(page, N.ups, 'Source'), /^Set by Pat · Oct 9, /);
  assert.equal(factOf(page, N.ups, 'AfterShip'), 'Exception · Customs clearance delay', 'AfterShip\'s words stay visible');
  assert.match(rowOf(page, N.ups), /<p class="shp-alert calm">Broker cleared it<\/p>/);
  assert.deepEqual(cards(page), ['4', '0', '1', '2']);
  // The form keeps the hand-set values.
  assert.match(rowOf(page, N.ups), new RegExp(`<select class="dz-pillinput" id="ship-st-${N.ups}"[^>]*>[\\s\\S]*?<option value="transit" selected>In transit</option>`));
  // AfterShip reports a newer scan (Oct 10, delivered): it wins again.
  await site.kv.put('tracking:index', JSON.stringify({ ...INDEX, polledAt: '2026-10-10T08:00:00.000Z', statuses: { ...AS, [N.ups]: asStatus(N.ups, 'delivered', { slug: 'ups', carrier: 'UPS', deliveredAt: '2026-10-10T09:00:00-04:00', changedAt: '2026-10-10T13:00:00.000Z' }) } }));
  page.run('shpAsLoad(true)');
  await settle();
  assert.deepEqual(status(page, N.ups), ['delivered', 'aftership']);
  assert.equal(factOf(page, N.ups, 'Source'), 'From AfterShip');
  assert.equal(factOf(page, N.ups, 'Status'), 'Delivered · Oct 10 · 2 days late');
  // A number AfterShip does not recognise: its words say so, and a hand-set status is all there is.
  await site.kv.put('tracking:index', JSON.stringify({ ...INDEX, statuses: { ...AS, [N.puro]: { ...asStatus(N.puro, 'shipped'), state: '', tag: '', status: 'Not tracked by AfterShip', error: 'AfterShip does not recognise this tracking number.' } } }));
  page.run('shpAsLoad(true)');
  await settle();
  page.run(`toggleShipment('${N.puro}')`);
  assert.equal(factOf(page, N.puro, 'AfterShip'), 'AfterShip does not recognise this tracking number.');
  assert.deepEqual(status(page, N.puro), ['', '']);
  assert.deepEqual(page.errors, []);
});

test('a refused key or a rate limit shows one short note; the next read comes a few minutes after the next 2-hourly check', async () => {
  const site = await hostedSite({ index: { ...INDEX, lastError: { at: POLLED_AT, message: 'AfterShip refused the API key. Check AFTERSHIP_API_KEY (Worker and Pages secrets).' } } });
  const page = await hostedBrowser(site, 'Pat');
  assert.match(html(page), /<p class="shp-note warn">AfterShip check stopped: AfterShip refused the API key\. Check AFTERSHIP_API_KEY \(Worker and Pages secrets\)\.<\/p>/);
  assert.equal(page.run('Boolean(shpAs.timer)'), true, 'a re-read is scheduled while the page is open');
  // Every 2 hours on the even UTC hour; the page reads 3 minutes later.
  assert.equal(page.run("new Date(shpAsNextCheck(Date.parse('2026-10-09T09:30:00Z'))).toISOString()"), '2026-10-09T10:00:00.000Z');
  assert.equal(page.run("new Date(shpAsNextCheck(Date.parse('2026-10-09T10:00:00Z'))).toISOString()"), '2026-10-09T12:00:00.000Z');
  assert.equal(page.run('SHP_AS_AFTER_MS'), 3 * 60000);
  // The tab comes back into view: read again (when the last read is 5 minutes old or more).
  const before = site.calls.filter((c) => c === 'GET /api/shipping').length;
  page.ctx.document.visibilityState = 'visible';
  page.dispatch('visibilitychange', {});
  await settle();
  assert.equal(site.calls.filter((c) => c === 'GET /api/shipping').length, before, 'just read: not again');
  page.run('shpAs.at-=6*60000');
  page.dispatch('visibilitychange', {});
  await settle();
  assert.equal(site.calls.filter((c) => c === 'GET /api/shipping').length, before + 1);
  // Without the key on this site and no recent check: automatic tracking is not set up.
  const off = await hostedSite({ index: null, key: false });
  const p2 = await hostedBrowser(off, 'Pat');
  assert.match(html(p2), /Automatic tracking isn’t set up, so statuses are set by hand\./);
  assert.equal(p2.run('shippingHeadMeta()'), '6 shipments');
});

test('hand-set status on a static host: saved in this browser, drives the status, the strip and the cards', async () => {
  const page = await shipPage();
  // Nothing set yet: every shipment has no status; the ones shipped 2+ days ago have had no update.
  assert.deepEqual(cards(page), ['0', '0', '0', '5']);
  assert.deepEqual(strip(page, N.parcel), [1, '']);
  assert.equal(stateText(page, N.parcel), 'No status');
  assert.deepEqual(etaText(page, N.parcel), ['Oct 10', 'No update yet']);

  setStatus(page, N.parcel, 'transit', '2026-10-09', 'At the Regina hub');
  setStatus(page, N.freight, 'shipped', '2026-10-08');
  setStatus(page, N.ups, 'delayed', '2026-10-09', 'Weather hold');
  setStatus(page, N.delivered, 'delivered', '2026-10-08');
  setStatus(page, N.usa, 'delivered', '2026-10-01'); // delivered last week
  const saved = JSON.parse(page.storage.spyderKpiShipmentsV1);
  assert.deepEqual(Object.keys(saved).sort(), [N.parcel, N.freight, N.ups, N.delivered, N.usa].map((n) => `st:${n}`).sort());
  assert.deepEqual({ ...saved[`st:${N.parcel}`], at: 'x' }, { order: '600', number: N.parcel, status: 'transit', statusDate: '2026-10-09', note: 'At the Regina hub', by: '', at: 'x' });
  assert.match(page.els.toast.innerHTML, /770099990001: Delivered Oct 1 saved in this browser\./);
  assert.deepEqual(page.run('shippingManualEntries()'), []);

  assert.deepEqual(cards(page), ['2', '1', '1', '1']);
  assert.match(html(page), /data-tip="In transit: 2 shipments \(2 orders, worth \$21,500\) on the way: Shipped or In transit; click to list only these\."/);
  assert.deepEqual([strip(page, N.parcel), strip(page, N.freight), strip(page, N.ups), strip(page, N.delivered)], [[2, ''], [1, ''], [2, 'red'], [3, 'teal']]);
  assert.deepEqual(etaText(page, N.delivered), ['Delivered Oct 8', 'promised Oct 7']);
  assert.match(rowOf(page, N.delivered), /<b class="late">Delivered Oct 8<\/b>/);
  assert.deepEqual(etaText(page, N.parcel), ['Oct 10', 'Updated just now']);
  assert.deepEqual(listed(page).slice(0, 2), [N.ups, N.puro], 'delayed first, then no update for 2+ days');
  assert.deepEqual(listed(page).slice(-2), [N.delivered, N.usa], 'delivered last, newest first');
  const detail = rowOf(page, N.parcel);
  assert.equal(factOf(page, N.parcel, 'Status'), 'In transit · Oct 9');
  assert.match(factOf(page, N.parcel, 'Source'), /^Set by hand · Oct 9, /);
  assert.match(detail, /<p class="shp-alert calm">At the Regina hub<\/p>/);
  assert.match(detail, /<span class="m">SPY-100<\/span>/);
  assert.deepEqual(page.errors, []);
});

test('cards filter the list; No update in 2+ days counts statuses set 2 or more days ago and shipments with none since shipping', async () => {
  const at = (d) => `${d}T10:00:00.000Z`;
  const storage = { spyderKpiShipmentsV1: JSON.stringify({
    [`st:${N.parcel}`]: { order: '600', number: N.parcel, status: 'transit', statusDate: '2026-10-06', note: '', by: 'Ann', at: at('2026-10-06') },
    [`st:${N.freight}`]: { order: '602', number: N.freight, status: 'shipped', statusDate: '2026-10-08', note: '', by: 'Ann', at: at('2026-10-08') },
    [`st:${N.delivered}`]: { order: '604', number: N.delivered, status: 'delivered', statusDate: '2026-10-03', note: '', by: 'Ann', at: at('2026-10-03') },
    [`st:${N.usa}`]: { order: '601', number: N.usa, status: 'delayed', statusDate: '', note: 'customs', by: 'Ann', at: at('2026-10-01'), deleted: true },
  }) };
  const page = await shipPage({ storage });
  assert.deepEqual(cards(page), ['2', '0', '0', '4']);
  assert.deepEqual(page.run('shippingModel().groups.stale.map(s=>s.number)').sort(), [N.parcel, N.usa, N.ups, N.puro].sort());
  assert.match(html(page), /data-focus-key="ship-kpi-stale"[^>]*data-tip="No update in 2\+ days: 4 shipments \(4 orders, worth \$[\d,]+\) not delivered and no AfterShip or hand update for 2 days or more; click to list only these\."/);
  assert.match(html(page), /<span class="shp-tile-s">Updated \d days ago<\/span><span class="shp-tile-s">3 with no update yet<\/span>/);
  page.run("setShippingFilter('stale')");
  let m = html(page);
  assert.match(m, /data-focus-key="ship-kpi-stale" aria-pressed="true"/);
  assert.equal((m.match(/class="shp-head"/g) || []).length, 4);
  assert.match(m, /with no update in 2\+ days<span aria-hidden="true">×<\/span>/);
  page.run("setShippingFilter('stale')");
  m = html(page);
  assert.equal((m.match(/class="shp-head"/g) || []).length, 6);
  assert.doesNotMatch(m, /Not checked in 2\+ days|Never checked/);
});

test('a hand-set status round-trips through the shared notes store (/api/notes): every browser that signs in sees it', async () => {
  const site = await hostedSite({ index: null, key: false });
  const a = await hostedBrowser(site, 'Kareena', '2026-10-07');
  assert.equal(a.run('sharedNotes.state'), 'shared');
  setStatus(a, N.ups, 'delayed', '2026-10-07', 'Held at the border');
  assert.match(a.els.toast.innerHTML, /1Z999AA10123456784: Delayed Oct 7 saved for everyone\./);
  await a.run('flushSharedNotes({all:true})');
  const stored = site.kv.json('overrides').shipments[`st:${N.ups}`];
  assert.deepEqual({ ...stored, at: 'x' }, { order: '603', number: N.ups, status: 'delayed', statusDate: '2026-10-07', note: 'Held at the border', by: 'Kareena', at: 'x' });

  const b = await hostedBrowser(site, 'Jamie Cole', '2026-10-08');
  assert.equal(card(b, 'delayed'), '1');
  assert.equal(stateText(b, N.ups), 'Delayed');
  setStatus(b, N.ups, 'delivered', '2026-10-08', '');
  await b.run('flushSharedNotes({all:true})');
  a.run('sharedNotes.syncedAt=0');
  await a.ctx.syncSharedNotes();
  a.run('renderResults()');
  assert.equal(a.run(`shippingStatusEntries().get('${N.ups}').status`), 'delivered');
  assert.deepEqual([...a.errors, ...b.errors], []);
});

test('Add tracking #: any carrier, saved in this browser without a server, linked to its order, searchable, removable', async () => {
  const page = await shipPage();
  page.run('shipToggleAdd()');
  field(page, 'ship-add-number').value = 'nope';
  page.run('shippingAddManual()');
  assert.match(field(page, 'ship-add-status').textContent, /Type a tracking number/);
  field(page, 'ship-add-number').value = '7700 2222 3333';
  field(page, 'ship-add-order').value = 'SO 600';
  page.run('shippingAddManual()');
  const saved = JSON.parse(page.storage.spyderKpiShipmentsV1);
  assert.deepEqual(Object.keys(saved), ['770022223333']);
  assert.equal(saved['770022223333'].order, '600');
  assert.match(page.els.toast.innerHTML, /Tracking # 770022223333 added to order 600\. Open its tracking page, then set its status\./);
  assert.equal(field(page, 'ship-add-status').textContent, '');
  page.run("toggleShipment('770022223333')");
  assert.match(rowOf(page, '770022223333'), /<span class="shp-trk"><b>7700 2222 3333<\/b><em>Carrier not set<\/em><\/span>\s*<span class="shp-ord"><b>SO 600<\/b><em>Firefly RV<\/em><\/span>/);
  assert.match(rowOf(page, '770022223333'), /<td class="strong">600<\/td>/);
  setStatus(page, '770022223333', 'shipped', '2026-10-09');
  assert.deepEqual(page.run('shippingManualEntries().map(e=>e.number)'), ['770022223333']);
  page.run("onGlobalSearchInput('770022223333');applyGlobalSearch()");
  assert.deepEqual(page.run('globalSearchResults(currentMetrics()).rows.map(x=>[searchRowType(x.r),x.r.documentNumber])'), [['Sales order', '600']]);
  page.run("clearGlobalSearch();setTab('shipping');shippingRemoveManual('770022223333')");
  assert.equal(JSON.parse(page.storage.spyderKpiShipmentsV1)['770022223333'].deleted, true);
  assert.ok(!listed(page).includes('770022223333'));
});

test('no demo data: no made-up shipments, no switch or banner, no Settings choice; an old stored choice does nothing', async () => {
  const page = await shipPage({ storage: { spyderKpiShipDemo: '1', spyderKpiSettings: JSON.stringify({ shipDemoDefault: true }) } });
  for (const name of ['SHIP_DEMO_ROWS', 'SHIP_DEMO_DEFAULT', 'SHIP_DEMO_KEY', 'shippingDemoOn', 'shippingDemoList', 'setShippingDemo', 'stgShippingCard', 'shippingDemoChoice']) {
    assert.equal(page.run(`typeof ${name}`), 'undefined', name);
  }
  assert.deepEqual(listed(page).sort(), [...REAL].sort());
  const m = html(page);
  assert.doesNotMatch(m, /demo|DEMO1000|made-up|Show real shipments/i);
  assert.equal(page.run("'shipDemoDefault' in stgSpec()"), false);
  assert.equal(page.run('shippingModel().demo'), undefined);
  page.run("setTab('settings')");
  assert.doesNotMatch(html(page), /stg-shipdemo|demo shipments|Shipping page now shows/i);
  page.run("onGlobalSearchInput('Demo RV Co');applyGlobalSearch()");
  assert.equal(page.run('globalSearchResults(currentMetrics()).rows.length'), 0);
  // With no shipments the empty card shows instead.
  const none = await shipPage({ files: [exportFile(ROWS.filter((r) => !r.TrackingNumber || r.SourceType === 'Purchase Order'))] });
  assert.match(html(none), /No shipments to show/);
  assert.equal(none.run('shippingModel().list.length'), 0);
  assert.deepEqual([...page.errors, ...none.errors], []);
});

test('one TrackNo field with several numbers: commas, &, + or "and", or two whole numbers with a space between', async () => {
  const page = loadPage({ today: TODAY });
  const split = (v) => page.run(`shipSplit(${JSON.stringify(v)})`);
  assert.deepEqual(split('770012345678 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(split('770012345678 & 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(split('770012345678 and 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(split('7700 1234 5678, 7700-1234-5679 + 1234567890'), ['770012345678', '770012345679', '1234567890']);
  assert.deepEqual(split('7700 1234 5678'), ['770012345678'], 'grouped digits are one number');
  // Same rule as the server module (shared/aftership.mjs splitTrackingNumbers).
  const { splitTrackingNumbers } = await import('../shared/aftership.mjs');
  for (const v of ['770012345678 770012345679', '7700 1234 5678 and 7700 1234 5679', 'a & b', '1234567890 + 7700-1234-5678', ' SANDBOX123 ']) assert.deepEqual(split(v), splitTrackingNumbers(v), v);
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

test('a shared snapshot keeps the hand-set and AfterShip statuses, shows no form and never calls the server', async () => {
  const site = await hostedSite({ index: INDEX });
  const page = await hostedBrowser(site, 'Pat');
  setStatus(page, N.puro, 'delayed', '2026-10-09', 'Weather hold');
  let payload = '';
  Object.assign(page.ctx, { buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  await page.ctx.exportShareSnapshot();
  const data = JSON.parse(payload);
  assert.equal(data.activeTab, 'shipping');
  assert.equal(data.shipping.manual[`st:${N.puro}`].status, 'delayed');
  assert.equal(data.shipping.demo, undefined);
  assert.deepEqual(Object.keys(data.shipping.aftership.statuses).sort(), Object.keys(AS).sort());
  assert.equal(data.shipping.aftership.polledAt, INDEX.polledAt);

  const snap = loadPage({ today: '2026-10-20' });
  const calls = [];
  Object.assign(snap.ctx, { fetch: async (u) => { calls.push(u); throw new Error('no network'); }, location: { href: 'file:///snap.html', protocol: 'file:' } });
  snap.els['embedded-snapshot-data'].dataset.encoding = 'json';
  snap.els['embedded-snapshot-data'].textContent = payload;
  await snap.run('loadEmbeddedSnapshot()');
  const m = html(snap);
  assert.equal(stateText(snap, N.puro), 'Delayed');
  assert.equal(stateText(snap, N.parcel), 'In transit');
  assert.deepEqual(strip(snap, N.delivered), [3, 'teal']);
  assert.match(snap.run('shippingHeadMeta()'), /^Updated Oct 9, 8:00 AM$/, 'no next time in a snapshot');
  assert.doesNotMatch(m, /ship-add-number|ship-st-|Automatic tracking/);
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

test('every tile, button, link, field and shipment row on the page has a plain-English tooltip or name; markup is balanced', async () => {
  for (const hosted of [false, true]) {
    const page = hosted ? await hostedBrowser(await hostedSite({ index: INDEX }), 'Pat') : await shipPage();
    page.run(`toggleShipment('${N.usa}')`);
    const m = html(page);
    const own = m.slice(m.indexOf('class="shp-frow'));
    for (const tag of own.match(/<(button|a|select|input)\b[^>]*>/g)) {
      if (/class="dz-menu-item/.test(tag)) continue; // menu choices: their text is the name
      assert.match(tag, /data-tip="[^"]{12,}"|aria-label="[^"]{6,}"/, tag);
    }
    assert.equal((own.match(/<button type="button" class="shp-tile/g) || []).length, 4);
    assert.match(page.run('PAGE_TIPS.shipping'), /AfterShip every 2 hours/);
    assert.doesNotMatch(m.replace(/<[^>]+>/g, ' '), /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]/);
    assert.doesNotMatch(m, /FedEx statuses|Live FedEx|Not checked/);
    const count = (needle) => m.split(needle).length - 1;
    for (const tag of ['div', 'table', 'tr', 'td', 'section', 'button', 'span', 'form', 'label', 'details', 'select', 'a', 'p']) {
      assert.equal(count(`<${tag} `) + count(`<${tag}>`) + count(`<${tag}\n`), count(`</${tag}>`), `unbalanced <${tag}> (${hosted ? 'hosted' : 'file'})`);
    }
    assert.deepEqual(page.errors, []);
  }
});

test('SAP text, notes and AfterShip text cannot inject markup into the Shipping page', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const page = await shipPage({ files: [exportFile([delivery({ DocumentNumber: '700', CustomerVendorName: evil, ShipMethod: evil, ShipToCountry: '<b>', DeliveryDocNumber: '9100', TrackingNumber: `${N.parcel}, ${evil}`, ShipDate: '10/06/2026', 'Item No.': evil })])] });
  setStatus(page, N.parcel, 'delayed', '2026-10-09', `"><script>x</script>${evil}`);
  page.run(`toggleShipment('${N.parcel}');toggleShipment('${N.parcel}')`);
  assert.doesNotMatch(html(page), /<img src=x|<script>x/);
  assert.deepEqual(listed(page), [N.parcel]);
  const site = await hostedSite({ index: { ...INDEX, statuses: { [N.parcel]: asStatus(N.parcel, 'delayed', { carrier: evil, detail: evil, changedAt: '2026-10-09T12:00:00.000Z', lastEvent: { at: evil, city: evil, desc: evil } }) }, lastError: { at: '2026-10-09T09:00:00.000Z', message: evil } } });
  const hosted = await hostedBrowser(site, 'Pat');
  hosted.run(`toggleShipment('${N.parcel}')`);
  assert.doesNotMatch(html(hosted), /<img src=x|<script>x/);
  assert.match(html(hosted), /&lt;img src=x/);
});

// --- The hosted site: /api/notes, /api/people and /api/shipping over one KV stand-in ---
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
// index: the AfterShip results the Worker saved (tracking:index); key: whether this Pages project has the AfterShip key.
async function hostedSite({ index = null, key = true } = {}) {
  const kv = memoryKv();
  if (index) await kv.put('tracking:index', JSON.stringify(index));
  const env = { REPORT_STORE: kv, ...(key ? { AFTERSHIP_API_KEY: 'test-key' } : {}) };
  const fns = {
    '/api/notes': (await import('../functions/api/notes.js')).onRequest,
    '/api/people': (await import('../functions/api/people.js')).onRequest,
    '/api/shipping': (await import('../functions/api/shipping.js')).onRequest,
  };
  const site = { kv, env, calls: [] };
  site.fetch = async (url, init = {}) => {
    site.calls.push(`${init.method || 'GET'} ${url}`);
    if (!fns[url]) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return fns[url]({ request: new Request(ORIGIN + url, { ...init, headers: { ...(init.headers || {}), Origin: ORIGIN } }), env, params: {} });
  };
  return site;
}
async function hostedBrowser(site, name, today = TODAY) {
  const page = loadPage({ today, storage: { spyderKpiEditorName: name } });
  Object.assign(page.ctx, { fetch: site.fetch, location: { href: ORIGIN + '/', protocol: 'https:' } });
  await upload(page, [exportFile()]);
  await page.ctx.syncSharedNotes();
  page.run("setTab('shipping')");
  await settle();
  return page;
}

run();
