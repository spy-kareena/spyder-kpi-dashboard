// The Shipping page (index.html), 2v6.9: shipments from SAP deliveries (any carrier) and numbers added by hand;
// statuses from AfterShip (read from /api/shipping, which the scheduled Worker fills every 2 hours) with a hand-set
// status (Shipped / In transit / Delayed / Delivered + date + note, saved through the shared notes store) as an
// override when it is newer; cards and the progress strip from those statuses; an external-link icon per row to
// AfterShip's public tracking page; search; snapshots; no demo data. 2v6.9: Not delivered and Priority cards, the
// Priority tick (shared), a state icon and the last location on each row, Update all, and pages of 10 / 5 / 5.
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
const cards = (page) => ['transit', 'delayed', 'delivered', 'open', 'priority'].map((id) => card(page, id));
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
const etaText = (page, number) => (rowOf(page, number).match(/<span class="shp-eta"><b[^>]*>([^<]*)<\/b>(?:<em[^>]*>([^<]*)<\/em>)?<\/span>/) || []).slice(1).map((x) => x ?? '');
const lastLoc = (page, number) => (rowOf(page, number).match(/<span class="shp-loc">Last: ([^<]*)</) || [])[1] || '';
// The Priority tick, as its checkbox does it (the test page has no real DOM: a stand-in element).
const tickPriority = (page, number, on) => page.run(`shpPriToggle({checked:${on},dataset:{n:'${number}'}})`);
// The carrier chip before the number: 'logo:<mark>' (2v6.9c: the full-colour FedEx / UPS / DHL logo images, Simple Icons
// for USPS) or 'text:<name>' (the name in the chip).
const carrierChip = (page, number) => { const m = rowOf(page, number).match(/<span class="shp-trk"><span class="shp-cr (logo|text)[^"]*" role="img" aria-label="([^"]*)"[^>]*>(?:<(?:svg|img) class="shp-cr-([a-z]+)"|<span aria-hidden="true">([^<]*)<)/); return m ? `${m[1]}:${m[3] || m[4]}` : undefined; };
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
  // 2v6.9c: no page meta at all (the count is on the Shipments card, owner).
  assert.equal(page.run('shippingHeadMeta()'), '6 shipments');
  assert.doesNotMatch(m, /<span class="page-meta"/);
  assert.match(m, /6 shipments/);
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
  assert.match(css, /\/\* 2v8:ship \*\/[\s\S]*a\.dz-btn\.shp-open\{width:30px;height:30px;[\s\S]*\/\* 2v8:end ship \*\/\n\/\* 2v9:ship \*\/[\s\S]*\/\* 2v9:end ship \*\/\n\/\* 2v7:motion \*\//);
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
  // Not delivered: the five others, two of them with no update in 2+ days: usa (last scan Oct 5) and puro (no
  // AfterShip record, shipped Sep 15); Priority: none ticked.
  assert.deepEqual(cards(page), ['3', '1', '1', '5', '0']);
  // 2v6.9b: a narrow card shows the short form (the small cards over the map, phones).
  assert.match(html(page), /data-focus-key="ship-kpi-open"[\s\S]*?<span class="shp-tile-s warn"><span class="shp-ts-w">2 with no update in 2\+ days<\/span><span class="shp-ts-n">2 no update 2\+ days<\/span><\/span><span class="shp-tile-s">1 with no status yet<\/span>/);
  assert.deepEqual(page.run('shippingModel().groups.stale.map(s=>s.number)').sort(), [N.usa, N.puro].sort());
  assert.deepEqual([strip(page, N.parcel), strip(page, N.ups), strip(page, N.delivered), strip(page, N.freight), strip(page, N.puro)], [[2, ''], [2, 'red'], [3, 'teal'], [1, ''], [1, '']]);
  assert.deepEqual([stateText(page, N.parcel), stateText(page, N.ups), stateText(page, N.puro)], ['In transit', 'Delayed', 'No status']);
  // ETA: AfterShip's expected date (Oct 12, past the due Oct 10: late) over the due date ("Due", 2v6.9b); no "Updated
  // ... ago" on the rows any more (2v6.9: the Shipments card's title row says when AfterShip was read).
  assert.deepEqual(etaText(page, N.parcel), ['Oct 12', 'Due Oct 10']);
  assert.deepEqual(etaText(page, N.delivered), ['Delivered Oct 8', 'Due Oct 7']);
  assert.match(rowOf(page, N.parcel), /<span class="shp-eta"><b class="late">Oct 12<\/b>/);
  assert.deepEqual(etaText(page, N.freight), ['Oct 9', 'Due']);
  assert.doesNotMatch(html(page), /romised/);
  assert.doesNotMatch(html(page), /class="shp-eta">[\s\S]{0,120}(Updated|No update yet)/);
  // Under the progress bar, quietly: "Last:" and the carrier's last scan place (country code left off); nothing when
  // unknown.
  assert.deepEqual([lastLoc(page, N.parcel), lastLoc(page, N.ups), lastLoc(page, N.delivered), lastLoc(page, N.puro), lastLoc(page, N.freight)], ['Regina, SK', 'Blaine, WA', 'Columbus, OH', '', '']);
  // 2v6.9b: the carrier's logo before each number (no state icons): FedEx (FedEx Freight too) and UPS marks, a name
  // chip for Purolator; the carrier's name is the chip's label, and the old carrier line under the number is gone.
  assert.deepEqual([carrierChip(page, N.parcel), carrierChip(page, N.freight), carrierChip(page, N.ups), carrierChip(page, N.puro)], ['logo:fedex', 'logo:fedex', 'logo:ups', 'text:Purolator']);
  assert.match(rowOf(page, N.freight), /<span class="shp-cr logo img" role="img" aria-label="FedEx Freight"><img class="shp-cr-fedex" src="data:image\/png;base64,[A-Za-z0-9+\/=]+" alt="" aria-hidden="true"><\/span>/);
  assert.match(rowOf(page, N.ups), /<span class="shp-trk-t"><b>1Z999AA10123456784<\/b><\/span>/);
  assert.doesNotMatch(html(page), /shp-ico|SHP_ROW_ICONS/);
  assert.match(page.ctx.document.documentElement.outerHTML, /Simple Icons project \(simpleicons\.org, CC0\)/);
  // Details: AfterShip's own status (its tag in words, then its detail), the last scan and the expected date; no
  // Source or AfterShip rows (2v6.9b).
  page.run(`toggleShipment('${N.ups}')`);
  assert.equal(factOf(page, N.ups, 'Status'), 'Exception · Customs clearance delay');
  assert.equal(factOf(page, N.ups, 'Source'), undefined);
  assert.equal(factOf(page, N.ups, 'AfterShip'), undefined);
  assert.equal(factOf(page, N.ups, 'Due'), 'Oct 8');
  assert.equal(factOf(page, N.ups, 'Promised'), undefined);
  page.run(`toggleShipment('${N.parcel}')`);
  assert.equal(factOf(page, N.parcel, 'Status'), 'In transit · Arrived at FedEx location', 'no detail: the latest scan words');
  assert.match(factOf(page, N.ups, 'Last scan'), /^Clearance delay: commercial invoice missing · Blaine, WA, US · Oct 8, 2:00 PM$/);
  assert.equal(page.run(`shipCarrier(shippingModel().list.find(x=>x.number==='${N.ups}'))`), 'UPS');
  // The Delayed list shows AfterShip's latest scan.
  assert.match(html(page), /class="shp-li exc" data-focus-key="ship-d-1Z999AA10123456784"[\s\S]*?<span class="shp-li-why">Clearance delay: commercial invoice missing<\/span>/);
  // When AfterShip was last read (2v6.9b: no next check time): in the Shipments card's title row next to the count and
  // Update all; the page head keeps only the count.
  assert.equal(page.run('shpAsUpdatedText()'), 'Updated 8:00 AM');
  assert.equal(page.run('shippingHeadMeta()'), '6 shipments');
  assert.match(html(page), /<span class="dz-meta"><span class="shp-count">6 shipments<\/span><span class="shp-upd"[^>]*>Updated 8:00 AM<\/span><button type="button" class="dz-btn shp-updall" data-focus-key="ship-update-all" onclick="shpAsRefreshAll\(\)"[^>]*><svg[\s\S]*?<span>Update all<\/span><\/button><\/span>/);
  assert.doesNotMatch(html(page).slice(0, html(page).indexOf('shp-frow')), /Updated/);
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
  // 2v6.9b: the Status row keeps AfterShip's own status; the note set by hand shows under the facts.
  assert.equal(factOf(page, N.ups, 'Status'), 'Exception · Customs clearance delay', 'AfterShip\'s words stay visible');
  assert.equal(factOf(page, N.ups, 'Source'), undefined);
  assert.match(rowOf(page, N.ups), /<p class="shp-alert calm">Broker cleared it<\/p>/);
  assert.deepEqual(cards(page), ['4', '0', '1', '5', '0']);
  // The form keeps the hand-set values.
  assert.match(rowOf(page, N.ups), new RegExp(`<select class="dz-pillinput" id="ship-st-${N.ups}"[^>]*>[\\s\\S]*?<option value="transit" selected>In transit</option>`));
  // AfterShip reports a newer scan (Oct 10, delivered): it wins again.
  await site.kv.put('tracking:index', JSON.stringify({ ...INDEX, polledAt: '2026-10-10T08:00:00.000Z', statuses: { ...AS, [N.ups]: asStatus(N.ups, 'delivered', { slug: 'ups', carrier: 'UPS', deliveredAt: '2026-10-10T09:00:00-04:00', changedAt: '2026-10-10T13:00:00.000Z' }) } }));
  page.run('shpAsLoad(true)');
  await settle();
  assert.deepEqual(status(page, N.ups), ['delivered', 'aftership']);
  assert.equal(factOf(page, N.ups, 'Status'), 'Delivered · 2 days late');
  // A number AfterShip does not recognise: its words say so, and a hand-set status is all there is.
  await site.kv.put('tracking:index', JSON.stringify({ ...INDEX, statuses: { ...AS, [N.puro]: { ...asStatus(N.puro, 'shipped'), state: '', tag: '', status: 'Not tracked by AfterShip', error: 'AfterShip does not recognise this tracking number.' } } }));
  page.run('shpAsLoad(true)');
  await settle();
  page.run(`toggleShipment('${N.puro}')`);
  assert.equal(factOf(page, N.puro, 'Status'), 'AfterShip does not recognise this tracking number.', 'no status: AfterShip\'s words say why');
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
  assert.deepEqual(cards(page), ['0', '0', '0', '6', '0']);
  assert.deepEqual(strip(page, N.parcel), [1, '']);
  assert.equal(stateText(page, N.parcel), 'No status');
  assert.deepEqual(etaText(page, N.parcel), ['Oct 10', 'Due']);
  assert.equal(carrierChip(page, N.parcel), 'logo:fedex');
  assert.equal(lastLoc(page, N.parcel), '', 'no AfterShip scan: no last location');

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

  assert.deepEqual(cards(page), ['2', '1', '1', '4', '0']);
  assert.match(html(page), /data-tip="In transit: 2 shipments\n• Shipped or in transit\n• 2 orders · \$21,500\nClick to list them\."/);
  assert.deepEqual([strip(page, N.parcel), strip(page, N.freight), strip(page, N.ups), strip(page, N.delivered)], [[2, ''], [1, ''], [2, 'red'], [3, 'teal']]);
  assert.deepEqual(etaText(page, N.delivered), ['Delivered Oct 8', 'Due Oct 7']);
  assert.match(rowOf(page, N.delivered), /<b class="late">Delivered Oct 8<\/b>/);
  assert.deepEqual(etaText(page, N.parcel), ['Oct 10', 'Due']);
  assert.deepEqual([carrierChip(page, N.parcel), carrierChip(page, N.ups), carrierChip(page, N.delivered)], ['logo:fedex', 'logo:ups', 'logo:fedex']);
  assert.deepEqual(listed(page).slice(0, 2), [N.ups, N.puro], 'delayed first, then no update for 2+ days');
  assert.deepEqual(listed(page).slice(-2), [N.delivered, N.usa], 'delivered last, newest first');
  const detail = rowOf(page, N.parcel);
  assert.equal(factOf(page, N.parcel, 'Status'), 'In transit · Oct 9', 'no AfterShip: the status set by hand, and its date');
  assert.equal(factOf(page, N.parcel, 'Source'), undefined);
  assert.match(detail, /<p class="shp-alert calm">At the Regina hub<\/p>/);
  assert.match(detail, /<span class="m">SPY-100<\/span>/);
  assert.deepEqual(page.errors, []);
});

test('cards filter the list; Not delivered (it replaced No update in 2+ days) counts every shipment not delivered and says how many have had no update in 2+ days', async () => {
  const at = (d) => `${d}T10:00:00.000Z`;
  const storage = { spyderKpiShipmentsV1: JSON.stringify({
    [`st:${N.parcel}`]: { order: '600', number: N.parcel, status: 'transit', statusDate: '2026-10-06', note: '', by: 'Ann', at: at('2026-10-06') },
    [`st:${N.freight}`]: { order: '602', number: N.freight, status: 'shipped', statusDate: '2026-10-08', note: '', by: 'Ann', at: at('2026-10-08') },
    [`st:${N.delivered}`]: { order: '604', number: N.delivered, status: 'delivered', statusDate: '2026-10-03', note: '', by: 'Ann', at: at('2026-10-03') },
    [`st:${N.usa}`]: { order: '601', number: N.usa, status: 'delayed', statusDate: '', note: 'customs', by: 'Ann', at: at('2026-10-01'), deleted: true },
  }) };
  const page = await shipPage({ storage });
  assert.deepEqual(cards(page), ['2', '0', '0', '5', '0']);
  // No update in 2+ days is no longer a card; its count is the Not delivered card's first fact.
  assert.deepEqual(page.run('shippingModel().groups.stale.map(s=>s.number)').sort(), [N.parcel, N.usa, N.ups, N.puro].sort());
  assert.deepEqual(page.run('shippingModel().groups.open.map(s=>s.number)').sort(), [N.parcel, N.usa, N.ups, N.puro, N.freight].sort());
  assert.doesNotMatch(html(page), /ship-kpi-stale|>No update in 2\+ days</);
  assert.match(html(page), /data-focus-key="ship-kpi-open"[^>]*data-tip="Not delivered: 5 shipments\n• Shipped, in transit, delayed or no status\n• 5 orders · \$[\d,]+\nClick to list them\."/);
  assert.match(html(page), /data-focus-key="ship-kpi-open"[\s\S]*?<span class="shp-tile-s warn"><span class="shp-ts-w">4 with no update in 2\+ days<\/span><span class="shp-ts-n">4 no update 2\+ days<\/span><\/span><span class="shp-tile-s">3 with no status yet<\/span>/);
  page.run("setShippingFilter('open')");
  let m = html(page);
  assert.match(m, /data-focus-key="ship-kpi-open" aria-pressed="true"/);
  assert.equal((m.match(/class="shp-head"/g) || []).length, 5);
  assert.match(m, /not delivered<span aria-hidden="true">×<\/span>/);
  page.run("setShippingFilter('open')");
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
  assert.match(rowOf(page, '770022223333'), /<span class="shp-trk"><span class="shp-cr text none" role="img" aria-label="Carrier not set"><span aria-hidden="true">No carrier<\/span><\/span><span class="shp-trk-t"><b>7700 2222 3333<\/b><\/span><\/span>\s*<span class="shp-ord"><b>SO 600<\/b><em>Firefly RV<\/em><\/span>/);
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
  tickPriority(page, N.ups, true);
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
  assert.match(snap.run('shpAsUpdatedText()'), /^Updated Oct 9, 8:00 AM$/, 'no next time in a snapshot');
  assert.doesNotMatch(m, /ship-add-number|ship-st-|Automatic tracking|shp-updall/);
  // The Priority tick travels with it, read-only.
  assert.equal(data.shipping.manual[`pr:${N.ups}`].priority, true);
  assert.deepEqual(cards(snap).slice(3), ['5', '1']);
  assert.match(rowOf(snap, N.ups), new RegExp(`<input type="checkbox" class="kit-cb shp-pri-cb" data-n="${N.ups}" data-focus-key="ship-pri-${N.ups}" checked disabled`));
  tickPriority(snap, N.ups, false);
  assert.equal(snap.run(`shippingRealList().find(s=>s.number==='${N.ups}').priority`), true);
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

test('Priority (2v6.9): a round tick per row, saved in this browser without a server; its card, Delivered / Undelivered and the column sort', async () => {
  const page = await shipPage();
  // The column and an unticked box on every row (outside the row's button), with a name and a tip.
  assert.match(html(page), /<span role="columnheader" class="shp-th-pri" aria-sort="none"><button type="button" class="shp-sort" data-focus-key="ship-sort-priority" onclick="shpSort\('priority'\)"[^>]*>Priority</);
  assert.match(rowOf(page, N.ups), new RegExp(`<\\/button>\\s*<span class="shp-pri-cell"><label class="kit-check shp-pri-check" data-tip="Tick to mark as priority \\(this browser only\\)\\."><input type="checkbox" class="kit-cb shp-pri-cb" data-n="${N.ups}" data-focus-key="ship-pri-${N.ups}" aria-label="Priority: ${N.ups}" onchange="shpPriToggle\\(this\\)">`));
  assert.match(html(page), /data-focus-key="ship-kpi-priority"[\s\S]*?<span class="shp-tile-s">Tick one in the table<\/span>/);
  setStatus(page, N.delivered, 'delivered', '2026-10-08');
  tickPriority(page, N.ups, true);
  tickPriority(page, N.delivered, true);
  tickPriority(page, N.parcel, true);
  tickPriority(page, N.parcel, false);
  const saved = JSON.parse(page.storage.spyderKpiShipmentsV1);
  assert.deepEqual({ ...saved[`pr:${N.ups}`], at: 'x' }, { order: '603', number: N.ups, priority: true, by: '', at: 'x' });
  assert.equal(saved[`pr:${N.parcel}`].priority, false, 'an untick is saved, so it reaches every browser');
  // Priority ids are neither hand-added numbers nor statuses.
  assert.deepEqual(page.run('shippingManualEntries()'), []);
  assert.equal(page.run(`shippingStatusEntries().has('${N.ups}')`), false);
  page.run('renderResults()');
  assert.deepEqual(cards(page), ['0', '0', '1', '5', '2']);
  const m = html(page);
  assert.match(m, /<div class="shp-tile shp-pri" role="group" aria-label="Priority shipments">[\s\S]*?<span class="shp-tile-s">1 still on the way<\/span>[\s\S]*?data-focus-key="ship-kpi-prio-done" aria-pressed="false" onclick="setShippingFilter\('prio-done'\)"[^>]*><span class="shp-pri-name">Delivered<\/span><span class="shp-pri-lead" aria-hidden="true"><\/span><span class="shp-pri-n done">1<\/span>[\s\S]*?data-focus-key="ship-kpi-prio-open"[^>]*><span class="shp-pri-name">Undelivered<\/span><span class="shp-pri-lead" aria-hidden="true"><\/span><span class="shp-pri-n open">1<\/span>/);
  assert.match(rowOf(page, N.ups), /class="kit-cb shp-pri-cb"[^>]*checked aria-label/);
  // The card lists the priority shipments; Delivered / Undelivered list those.
  const heads = () => (html(page).match(/class="shp-head" data-focus-key="ship-([^"]+)"/g) || []).map((x) => x.split('ship-')[1].slice(0, -1));
  page.run("setShippingFilter('priority')");
  assert.deepEqual(heads().sort(), [N.ups, N.delivered].sort());
  assert.match(html(page), /data-focus-key="ship-kpi-priority" aria-pressed="true"/);
  page.run("setShippingFilter('prio-open')");
  assert.deepEqual(heads(), [N.ups]);
  assert.match(html(page), /priority, undelivered<span aria-hidden="true">×<\/span>/);
  page.run("setShippingFilter('prio-done')");
  assert.deepEqual(heads(), [N.delivered]);
  page.run("setShippingFilter('prio-done')");
  // The Priority column sorts like the others: ticked first, then reversed.
  page.run("shpSort('priority')");
  assert.deepEqual(heads().slice(0, 2).sort(), [N.ups, N.delivered].sort());
  assert.match(html(page), /aria-sort="ascending"><button type="button" class="shp-sort on" data-focus-key="ship-sort-priority"/);
  page.run("shpSort('priority')");
  assert.deepEqual(heads().slice(-2).sort(), [N.ups, N.delivered].sort());
  // Printing shows the word instead of the box.
  assert.match(rowOf(page, N.ups), /<span class="kit-print">Priority<\/span>/);
  assert.deepEqual(page.errors, []);
});

test('Priority ticks are shared through /api/notes: another browser sees them, and an untick there clears them here', async () => {
  const site = await hostedSite({ index: INDEX });
  const a = await hostedBrowser(site, 'Kareena', '2026-10-07');
  tickPriority(a, N.usa, true);
  await a.run('flushSharedNotes({all:true})');
  assert.deepEqual({ ...site.kv.json('overrides').shipments[`pr:${N.usa}`], at: 'x' }, { order: '601', number: N.usa, priority: true, by: 'Kareena', at: 'x' });
  assert.match(rowOf(a, N.usa), /data-tip="Tick to mark|data-tip="Priority/);
  const b = await hostedBrowser(site, 'Jamie Cole', '2026-10-08');
  assert.equal(card(b, 'priority'), '1');
  assert.match(rowOf(b, N.usa), /class="kit-cb shp-pri-cb"[^>]*checked/);
  assert.match(rowOf(b, N.usa), /data-tip="Priority \(ticked by Kareena, Oct \d+, [^"]+\)\. Click to clear\."/);
  tickPriority(b, N.usa, false);
  await b.run('flushSharedNotes({all:true})');
  a.run('sharedNotes.syncedAt=0');
  await a.ctx.syncSharedNotes();
  a.run('renderResults()');
  assert.equal(card(a, 'priority'), '0');
  assert.deepEqual([...a.errors, ...b.errors], []);
});

// 23 deliveries shipped Oct 1-8: the first 12 to the US (cross-border), the rest in Canada.
const MANY = Array.from({ length: 23 }, (_, i) => delivery({ DocumentNumber: String(800 + i), DeliveryDocNumber: String(9800 + i), TrackingNumber: `77001000${String(i).padStart(4, '0')}`, ShipToCountry: i < 12 ? 'US' : 'CA', ShipDate: `10/0${1 + (i % 8)}/2026`, ...due('10/12/2026') }));
const manyNum = (i) => `77001000${String(i).padStart(4, '0')}`;

test('pages: Shipments 10 a page, Cross-border and Delayed 5; quiet page numbers; a new filter starts at page 1; print shows everything', async () => {
  // Seven of them delayed (hand-set).
  const storage = { spyderKpiShipmentsV1: JSON.stringify(Object.fromEntries([0, 2, 4, 13, 15, 17, 19].map((i) => [`st:${manyNum(i)}`, { order: String(800 + i), number: manyNum(i), status: 'delayed', statusDate: '2026-10-08', note: `hold ${i}`, by: 'Ann', at: '2026-10-08T10:00:00.000Z' }]))) };
  const page = await shipPage({ storage, files: [exportFile(MANY)] });
  const rows = () => (html(page).match(/class="shp-head"/g) || []).length;
  const pager = (what) => (html(page).match(new RegExp(`<nav class="shp-pager print-hide" aria-label="${what} pages"[\\s\\S]*?</nav>`)) || [])[0] || '';
  assert.equal(rows(), 10);
  let p = pager('Shipments');
  assert.match(p, /^<nav class="shp-pager print-hide" aria-label="Shipments pages" onkeydown="shpPagerKey\(event,'list'\)"><button type="button" class="shp-pg arrow" data-focus-key="ship-pg-list-prev" aria-label="Previous page" aria-disabled="true"/);
  assert.deepEqual([...p.matchAll(/class="shp-pg( on)?" [^>]*>(\d+)</g)].map((x) => `${x[2]}${x[1] ? '*' : ''}`), ['1*', '2', '3']);
  assert.match(p, /aria-label="Page 1 of 3" aria-current="page"/);
  assert.doesNotMatch(html(page), /Show all|shp-more"/, 'the old Show all toggle is gone');
  page.run("shpGoPage('list',3)");
  assert.equal(rows(), 3);
  assert.match(pager('Shipments'), /aria-label="Page 3 of 3" aria-current="page"/);
  assert.match(pager('Shipments'), /data-focus-key="ship-pg-list-next" aria-label="Next page" aria-disabled="true"/);
  // Arrow keys step through the pages.
  page.run("shpPagerKey({key:'ArrowLeft',preventDefault(){}},'list')");
  assert.equal(page.run('shpPg.list'), 2);
  page.run("shpPagerKey({key:'Home',preventDefault(){}},'list')");
  assert.equal(page.run('shpPg.list'), 1);
  // A filter, the search or a sort start the table at page 1 again.
  page.run("shpGoPage('list',2);shpSort('track')");
  assert.equal(page.run('shpPg.list'), 1);
  page.run("shpGoPage('list',2);shipSearch('7700')");
  assert.equal(page.run('shpPg.list'), 1);
  page.run("shipSearch('');shpSort('track');shpSort('track');shipClearFilters()");
  // The side lists: 5 a page (12 cross-border, 7 delayed); their own pagers.
  assert.equal((html(page).match(/data-focus-key="ship-x-/g) || []).length, 5);
  assert.deepEqual([...pager('Cross-border').matchAll(/>(\d+)<\/button>/g)].map((x) => x[1]), ['1', '2', '3']);
  assert.equal((html(page).match(/data-focus-key="ship-d-/g) || []).length, 5);
  page.run("shpGoPage('delayed',2);shpGoPage('cross',3)");
  assert.equal((html(page).match(/data-focus-key="ship-d-/g) || []).length, 2);
  assert.equal((html(page).match(/data-focus-key="ship-x-/g) || []).length, 2);
  assert.doesNotMatch(html(page), /more in the table/);
  // A side row opens its shipment on the table page it is on.
  const last = page.run("shpSortList(shipFilteredList(shippingModel().list)).slice(-1)[0].number");
  page.run(`openShipment('${last}')`);
  assert.equal(page.run('shpPg.list'), 3);
  assert.match(html(page), new RegExp(`id="ship-detail-${last}"`));
  assert.equal(page.run('shpPg.delayed'), 2, 'the side lists keep their page');
  // Many pages: the first, the last and the ones around the current page.
  assert.deepEqual(page.run('shpPageNums(5,12)'), [1, '…', 4, 5, 6, '…', 12]);
  assert.deepEqual(page.run('shpPageNums(1,12)'), [1, 2, 3, 4, '…', 12]);
  assert.deepEqual(page.run('shpPageNums(4,12)'), [1, 2, 3, 4, 5, '…', 12]);
  assert.deepEqual(page.run('shpPageNums(12,12)'), [1, '…', 9, 10, 11, 12]);
  // Printing lists every shipment with no pager.
  page.run('printMode=true;renderResults()');
  assert.equal(rows(), 23);
  assert.doesNotMatch(html(page), /class="shp-pager/);
  page.run('printMode=false;renderResults()');
  // One page: no pager.
  page.run("setShippingFilter('delayed')");
  assert.equal(rows(), 7, '7 delayed, still one page of 10');
  assert.equal(pager('Shipments'), '');
  assert.deepEqual(page.errors, []);
});

test('Update all: asks AfterShip now (POST /api/shipping), busy while it runs, then reads the results again; a second try within 10 minutes says when', async () => {
  const site = await hostedSite({ index: INDEX });
  const posts = [];
  const real = site.fetch;
  site.fetch = async (url, init = {}) => {
    if (url === '/api/shipping' && init.method === 'POST') {
      site.calls.push(`POST ${url}`);
      posts.push(init);
      if (posts.length > 1) return new Response(JSON.stringify({ error: 'Refresh now was used less than 10 minutes ago. Try again in 9 min.', retryAfter: 540, refreshAfter: '2026-10-09T15:14:00.000Z' }), { status: 429, headers: { 'content-type': 'application/json' } });
      await site.kv.put('tracking:index', JSON.stringify({ ...INDEX, polledAt: '2026-10-09T15:04:00.000Z', source: 'refresh' }));
      return new Response(JSON.stringify({ polledAt: '2026-10-09T15:04:00.000Z', statuses: AS, errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return real(url, init);
  };
  const page = await hostedBrowser(site, 'Pat');
  page.ctx.fetch = site.fetch;
  const reads = () => site.calls.filter((c) => c === 'GET /api/shipping').length;
  const before = reads();
  page.run('shpAsRefreshAll()');
  assert.match(html(page), /<button type="button" class="dz-btn shp-updall busy" data-focus-key="ship-update-all" onclick="shpAsRefreshAll\(\)" aria-busy="true" aria-disabled="true"[^>]*><svg[\s\S]*?<span>Updating…<\/span>/);
  page.run('shpAsRefreshAll()');
  await settle();
  assert.equal(posts.length, 1, 'a click while busy does nothing');
  assert.equal(reads(), before + 1, 'read again after the check');
  assert.match(html(page), /<span>Update all<\/span>/);
  assert.match(page.run('shpAsUpdatedText()'), /^Updated \d{1,2}:04 [AP]M$/);
  assert.match(page.els.toast.innerHTML, /Every shipment updated from AfterShip\./);
  page.run('shpAsRefreshAll()');
  await settle();
  const at = page.run("shipClock(new Date('2026-10-09T15:14:00.000Z'))");
  assert.match(page.els.toast.innerHTML, new RegExp(`Updated less than 10 minutes ago, try again at ${at}\\.`));
  assert.deepEqual(page.errors, []);
  // Hidden without the AfterShip key on this site and on a file copy (the snapshot test checks a snapshot).
  const off = await hostedBrowser(await hostedSite({ index: INDEX, key: false }), 'Pat');
  assert.doesNotMatch(html(off), /shp-updall/);
  assert.match(html(off), /<span class="dz-meta"><span class="shp-count">6 shipments<\/span><\/span>/, 'no key and no recent check: just the count');
  const file = await shipPage();
  assert.doesNotMatch(html(file), /shp-updall|shp-upd"/);
  assert.match(html(file), /<span class="dz-meta"><span class="shp-count">6 shipments<\/span><\/span>/);
});

test('2v6.9 layout: on a wide screen the map card spans the page, the cards lie over its faded right part and the view keeps every dot left of them', async () => {
  const page = await shipPage();
  const lay = page.run('shpMapLayout()');
  assert.ok(lay && lay.w > 0 && lay.pw >= 320 && lay.a < lay.w - lay.pw, JSON.stringify(lay));
  const m = html(page);
  assert.match(m, new RegExp(`<div class="shp-top" style="--pw:${lay.pw}px"><div class="shp-tiles" role="group" aria-label="Shipment status">`));
  const stage = m.match(/<div class="shp-map-stage wide"[^>]*style="([^"]+)"/);
  assert.ok(stage, 'the wide stage');
  const fa = Number(stage[1].match(/--fa:([\d.]+)%/)[1]);
  assert.match(stage[1], /--fb:[\d.]+%/);
  // Every dot, the hub and every label sit left of where the fade starts.
  for (const [, left] of m.matchAll(/class="shp-(?:dot|hub|lbl)[^"]*" style="left:([\d.]+)%/g)) assert.ok(Number(left) < fa, `${left}% < ${fa}%`);
  // The CSS: the fade on the right with the top and bottom ones, and the cards over the map from 981px.
  const css = page.ctx.document.documentElement.outerHTML;
  const block = css.slice(css.indexOf('/* 2v9:ship */'), css.indexOf('/* 2v9:end ship */'));
  assert.match(block, /\.shp-top \.shp-map-stage\.wide \.shp-map-svg\{[^}]*linear-gradient\(to right,#000 var\(--fa,70%\),transparent var\(--fb,92%\)\)[^}]*mask-composite:intersect/);
  assert.match(block, /\.shp-top>\.shp-tiles\{grid-area:map;z-index:4;justify-self:end;[^}]*width:var\(--pw,340px\)/);
  assert.match(block, /prefers-reduced-motion:reduce\)\{[^}]*\.shp-pri-check \.kit-box svg/);
  // Below 981px the cards stack above the map: no wide stage.
  page.ctx.innerWidth = 900;
  page.run('renderResults()');
  assert.equal(page.run('shpMapLayout()'), null);
  assert.doesNotMatch(html(page), /shp-map-stage wide|--pw:/);
  // 2v6.9b: the legend sits at the bottom left of the map (not in the title row); the current page is a soft neutral
  // pill; the Priority card keeps its two rows compact on its right at 641-980px; a narrow card picks the short fact
  // lines; the small cards over the map are at least 364px wide together (one-line labels at 1180px).
  const mm = html(page);
  assert.match(mm, /<div class="shp-map-foot"><div class="shp-legend" aria-hidden="true"><span><i style="background:var\(--dz-indigo\)"><\/i>In transit<\/span>/);
  assert.doesNotMatch(mm.slice(mm.indexOf('<div class="shp-map-head">'), mm.indexOf('<div class="shp-map-stage')), /shp-legend/);
  assert.match(block, /\.shp-top \.shp-map-foot\{position:absolute;left:22px;right:auto;bottom:14px;/);
  assert.match(block, /\.shp-pg\.on,\.shp-pg\.on:hover\{background:var\(--dz-surface-2\);box-shadow:inset 0 0 0 1px var\(--dz-line-8\);color:var\(--dz-ink-1\);font-weight:600\}/);
  assert.doesNotMatch(block, /\.shp-pg\.on[^{]*\{[^}]*background:var\(--dz-indigo\)/);
  assert.match(block, /@media \(min-width:641px\) and \(max-width:980px\)\{\s*\.shp-top \.shp-tile\.shp-pri \.shp-pri-side\{flex:0 0 232px;margin-left:auto\}/);
  assert.match(block, /@container shptile \(max-width:230px\)\{\s*\.shp-tile-s \.shp-ts-w\{display:none\}/);
  page.ctx.innerWidth = 1180;
  assert.ok(page.run('shpMapLayout().pw') >= 364);
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
