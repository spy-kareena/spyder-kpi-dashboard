// Tests for shared/aftership.mjs (AfterShip Tracking API: adding numbers, reading them in batches, mapping AfterShip
// tags to the Shipping page's statuses, errors, the per-check budget). Run: node tests/aftership.test.mjs.
// AfterShip and Workers KV are stand-ins (tests/aftership-fixtures.mjs); nothing leaves the machine.
import assert from 'node:assert/strict';
import { memoryKv, fakeAfterShip, TRACKINGS, NUMBERS } from './aftership-fixtures.mjs';
import {
  normalizeTracking, pollTracking, wantedNumbers, cleanTrackingNumber, splitTrackingNumbers, aftershipConfigured, slugForCarrier,
  carrierName, maxPerRun, maxCalls, AfterShipError, TAG_STATE, TAGS, INDEX_KEY, WANTED_KEY, IDS_KEY, LIST_BATCH, MAX_PER_RUN, MAX_CALLS,
} from '../shared/aftership.mjs';

const NOW = Date.parse('2026-10-09T16:00:00Z');
const KEY = 'as-test-key-value-123';
const ALL = Object.values(NUMBERS);
const env = (wanted = { export: ALL, manual: [] }, extra = {}) => ({ REPORT_STORE: memoryKv({ [WANTED_KEY]: { v: 1, exportAsOf: '2026-10-08', ...wanted } }), AFTERSHIP_API_KEY: KEY, ...extra });
const poll = (e, fx, opts = {}) => pollTracking(e, { fetch: fx.fetch, now: NOW, ...opts });

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('every AfterShip tag maps to a page status', () => {
  assert.deepEqual(TAGS.map((t) => [t, TAG_STATE[t]]), [
    ['Pending', 'shipped'], ['InfoReceived', 'shipped'], ['InTransit', 'transit'], ['OutForDelivery', 'transit'], ['AttemptFail', 'delayed'],
    ['Delivered', 'delivered'], ['AvailableForPickup', 'transit'], ['Exception', 'delayed'], ['Expired', 'delayed'],
  ]);
  const st = (k) => normalizeTracking(TRACKINGS[k], TRACKINGS[k].tracking_number, NOW).state;
  assert.deepEqual(['pending', 'transit', 'out', 'pickup', 'failed', 'exception', 'expired', 'delivered'].map(st), ['shipped', 'transit', 'transit', 'transit', 'delayed', 'delayed', 'delayed', 'delivered']);
  assert.equal(normalizeTracking({ tag: 'SomethingNew' }, 'X', NOW).state, 'shipped', 'an unknown tag reads as Pending');
});

test('in transit: last checkpoint (message, place, time), expected delivery, carrier, when it changed', () => {
  const s = normalizeTracking(TRACKINGS.transit, NUMBERS.transit, NOW);
  assert.deepEqual([s.number, s.id, s.slug, s.carrier, s.tag, s.status, s.state, s.stage], [NUMBERS.transit, 'as-transit', 'fedex', 'FedEx', 'InTransit', 'In transit', 'transit', 'inTransit']);
  assert.deepEqual(s.lastEvent, { at: '2026-10-08T06:10:00-06:00', city: 'Regina, SK, CAN', desc: 'Arrived at FedEx location' });
  assert.equal(s.eta, '2026-10-12T17:00:00-05:00');
  assert.equal(s.changedAt, '2026-10-08T12:10:00.000Z');
  assert.equal(s.shippedAt, '2026-10-06T15:00:00-06:00');
  assert.equal(s.deliveredAt, '');
  assert.equal(s.checkedAt, new Date(NOW).toISOString());
});

test('delivered: delivery date, no ETA; exception: the reason text and the location field', () => {
  const d = normalizeTracking(TRACKINGS.delivered, NUMBERS.delivered, NOW);
  assert.deepEqual([d.state, d.deliveredAt, d.eta, d.destCountry], ['delivered', '2026-10-08T10:12:00-04:00', '', 'USA']);
  const x = normalizeTracking(TRACKINGS.exception, NUMBERS.exception, NOW);
  assert.deepEqual([x.state, x.status, x.detail, x.carrier], ['delayed', 'Exception', 'Customs clearance delay', 'UPS']);
  assert.deepEqual(x.lastEvent, { at: '2026-10-08T14:00:00-04:00', city: 'Blaine, WA, US', desc: 'Clearance delay: commercial invoice missing' });
  const p = normalizeTracking(TRACKINGS.pending, NUMBERS.pending, NOW);
  assert.deepEqual([p.state, p.lastEvent, p.changedAt], ['shipped', null, ''], 'nothing from the carrier yet: no event, no change time');
  assert.equal(carrierName('some-new-courier'), 'Some New Courier');
});

// 2v6.9 cities: the carrier's destination city and state, for the page's Order Map when SAP has no ship-to city.
test('destination city and state: from destination_city / destination_state, tidied and clipped; \'\' when AfterShip has none or refuses the number', async () => {
  const d = normalizeTracking(TRACKINGS.delivered, NUMBERS.delivered, NOW);
  assert.deepEqual([d.destCity, d.destState, d.destCountry], ['Columbus', 'OH', 'USA']);
  const t = normalizeTracking(TRACKINGS.transit, NUMBERS.transit, NOW);
  assert.deepEqual([t.destCity, t.destState], ['', ''], 'none given');
  const nul = normalizeTracking({ ...TRACKINGS.transit, destination_city: null, destination_state: null }, NUMBERS.transit, NOW);
  assert.deepEqual([nul.destCity, nul.destState], ['', '']);
  const long = normalizeTracking({ ...TRACKINGS.transit, destination_city: `  Saint-Jean-sur-\n  Richelieu ${'x'.repeat(80)}`, destination_state: ` ${'Q'.repeat(50)} ` }, NUMBERS.transit, NOW);
  assert.equal(long.destCity.length, 60);
  assert.match(long.destCity, /^Saint-Jean-sur- Richelieu x+$/, 'spaces and line breaks tidied');
  assert.equal(long.destState, 'Q'.repeat(40));
  // The destination as the carrier writes it, tidied ('' when absent).
  assert.equal(normalizeTracking({ ...TRACKINGS.transit, destination_raw_location: '  ELKHART, IN,\n US ' }, NUMBERS.transit, NOW).destRaw, 'ELKHART, IN, US');
  assert.equal(t.destRaw, '');
  // Through a check: a number read from AfterShip keeps them in the index; a refused one has them empty, with the
  // same fields as any other status.
  const e = env({ export: [NUMBERS.delivered, 'BAD000001'], manual: [] });
  const doc = await poll(e, fakeAfterShip({ known: [NUMBERS.delivered], refuse: ['BAD000001'] }));
  assert.deepEqual([doc.statuses[NUMBERS.delivered].destCity, doc.statuses[NUMBERS.delivered].destState], ['Columbus', 'OH']);
  const bad = doc.statuses.BAD000001;
  assert.deepEqual([bad.state, bad.destCity, bad.destState, bad.destCountry], ['', '', '', '']);
  assert.deepEqual(Object.keys(bad).sort(), Object.keys(d).sort());
  assert.equal(e.REPORT_STORE.json(INDEX_KEY).statuses[NUMBERS.delivered].destCity, 'Columbus');
});

test('numbers: cleaned, split, hand-added first; carriers become slugs only when obvious; key and limits read from env', () => {
  assert.equal(cleanTrackingNumber('7700 1234-5678'), '770012345678');
  assert.equal(cleanTrackingNumber('Will Call'), '');
  assert.deepEqual(splitTrackingNumbers('770012345678 770012345679, 1234567890'), ['770012345678', '770012345679', '1234567890']);
  assert.deepEqual(wantedNumbers({ export: ['7700 1234 5678', 'nope', '1234567890'], manual: ['1234567890', '9999999999'] }), ['1234567890', '9999999999', '770012345678']);
  assert.deepEqual(['FedEx', 'FedEx Freight', 'UPS', 'Purolator', 'Day & Ross', 'Carrier not set', 'toString'].map(slugForCarrier), ['fedex', 'fedex-freight', 'ups', 'purolator', '', '', '']);
  assert.equal(aftershipConfigured({ AFTERSHIP_API_KEY: '  ' }), false);
  assert.equal(aftershipConfigured({ AFTERSHIP_API_KEY: KEY }), true);
  assert.deepEqual([maxPerRun({}), maxCalls({})], [MAX_PER_RUN, MAX_CALLS]);
  assert.deepEqual([maxPerRun({ AFTERSHIP_MAX_PER_RUN: '9999' }), maxCalls({ AFTERSHIP_MAX_CALLS: '200' }), maxCalls({ AFTERSHIP_MAX_CALLS: 'x' })], [600, 200, MAX_CALLS]);
});

test('first check: each new number is added once (no slug unless the carrier is obvious), with the key in as-api-key', async () => {
  const e = env({ export: [NUMBERS.transit, NUMBERS.exception, NUMBERS.pending], manual: [], carriers: { [NUMBERS.transit]: 'FedEx', [NUMBERS.pending]: 'Day & Ross' } });
  const fx = fakeAfterShip();
  const doc = await poll(e, fx);
  const creates = fx.creates();
  assert.deepEqual(creates.map((c) => [c.number, c.slug]), [[NUMBERS.transit, 'fedex'], [NUMBERS.exception, ''], [NUMBERS.pending, '']]);
  assert.ok(fx.calls.every((c) => c.key === KEY));
  assert.equal(fx.lists().length, 0, 'a number just added is not read again in the same check');
  assert.deepEqual([doc.count, doc.polled, doc.created, doc.waiting], [3, 3, 3, 0]);
  assert.equal(doc.statuses[NUMBERS.transit].state, 'shipped', 'AfterShip answers Pending until it has asked the carrier');
  const ids = e.REPORT_STORE.json(IDS_KEY).ids;
  assert.deepEqual(ids[NUMBERS.transit], { id: 'as-transit', slug: 'fedex', at: new Date(NOW).toISOString() });
  assert.deepEqual(e.REPORT_STORE.json(INDEX_KEY), doc);
  assert.equal(doc.provider, 'aftership');
  assert.ok(!JSON.stringify(e.REPORT_STORE.map.get(INDEX_KEY)).includes(KEY));
});

test('the next check reads known numbers in batches of 50 through GET /trackings (tracking_numbers, limit 200)', async () => {
  const e = env();
  const fx = fakeAfterShip();
  await poll(e, fx);
  const doc = await poll(e, fx, { now: NOW + 2 * 3600e3 });
  assert.equal(fx.creates().length, ALL.length, 'no number is added twice');
  const lists = fx.lists();
  assert.equal(lists.length, 1);
  assert.deepEqual(lists[0].numbers.sort(), [...ALL].sort());
  assert.equal(lists[0].limit, '200');
  const st = (k) => doc.statuses[NUMBERS[k]].state;
  assert.deepEqual(['transit', 'delivered', 'exception', 'pending', 'out', 'failed', 'expired', 'pickup'].map(st), ['transit', 'delivered', 'delayed', 'shipped', 'transit', 'delayed', 'delayed', 'transit']);
  assert.equal(doc.statuses[NUMBERS.exception].detail, 'Customs clearance delay');
  assert.equal(doc.created, 0);
  // 120 known numbers: three requests of at most 50.
  const many = Array.from({ length: 120 }, (_, i) => String(880000000000 + i));
  const e2 = env({ export: many, manual: [] });
  const fx2 = fakeAfterShip({ known: many, trackings: Object.fromEntries(many.map((n) => [n, { id: `as-${n}`, tracking_number: n, slug: 'fedex', tag: 'InTransit', checkpoints: [] }])) });
  await e2.REPORT_STORE.put(IDS_KEY, JSON.stringify({ v: 1, ids: Object.fromEntries(many.map((n) => [n, { id: `as-${n}`, slug: 'fedex', at: '2026-10-01T00:00:00Z' }])) }));
  const d2 = await poll(e2, fx2);
  assert.deepEqual(fx2.lists().map((c) => c.numbers.length), [LIST_BATCH, LIST_BATCH, 20]);
  assert.equal(d2.polled, 120);
});

test('"tracking already exists" counts as known: read with the others; its id is kept when AfterShip sends it', async () => {
  const e = env({ export: [NUMBERS.transit, NUMBERS.out], manual: [] });
  const fx = fakeAfterShip({ known: [NUMBERS.transit, NUMBERS.out], existsData: (n) => (n === NUMBERS.out ? { tracking: { id: 'as-out', slug: 'fedex', tracking_number: n } } : {}) });
  const doc = await poll(e, fx);
  assert.equal(fx.creates().length, 2);
  assert.equal(fx.lists().length, 1, 'both read in the same check');
  assert.equal(doc.statuses[NUMBERS.transit].state, 'transit');
  assert.equal(doc.statuses[NUMBERS.out].state, 'transit');
  const ids = e.REPORT_STORE.json(IDS_KEY).ids;
  assert.equal(ids[NUMBERS.out].id, 'as-out');
  assert.equal(ids[NUMBERS.transit].id, 'as-transit', 'the list answer fills in the id');
  // Next check: no create at all.
  await poll(e, fx, { now: NOW + 7200e3 });
  assert.equal(fx.creates().length, 2);
});

test('pagination: next_cursor is followed until has_next_page is false', async () => {
  const e = env();
  const fx = fakeAfterShip({ known: ALL, pageSize: 3 });
  await e.REPORT_STORE.put(IDS_KEY, JSON.stringify({ v: 1, ids: Object.fromEntries(ALL.map((n) => [n, { id: '', known: true, at: '2026-10-01T00:00:00Z' }])) }));
  const doc = await poll(e, fx);
  assert.deepEqual(fx.lists().map((c) => c.cursor), ['', '3', '6']);
  assert.equal(Object.keys(doc.statuses).length, ALL.length);
  assert.equal(fx.creates().length, 0);
});

test('delivered numbers are final: never read again; they stay listed for 45 days', async () => {
  const e = env();
  const fx = fakeAfterShip();
  await poll(e, fx);
  await poll(e, fx, { now: NOW + 7200e3 });
  await poll(e, fx, { now: NOW + 4 * 3600e3 });
  const third = fx.lists()[1];
  assert.ok(!third.numbers.includes(NUMBERS.delivered), 'not asked again');
  assert.equal(third.numbers.length, ALL.length - 1);
  // Still listed after it leaves the export, until 45 days after delivery.
  await e.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ v: 1, exportAsOf: '2026-10-20', export: [NUMBERS.transit], manual: [] }));
  const later = await poll(e, fx, { now: Date.parse('2026-10-30T00:00:00Z') });
  assert.equal(later.statuses[NUMBERS.delivered].state, 'delivered');
  const gone = await poll(e, fx, { now: Date.parse('2026-12-01T00:00:00Z') });
  assert.equal(gone.statuses[NUMBERS.delivered], undefined);
});

test('budget: at most 40 AfterShip requests per check (Workers Free: 50 subrequests); the rest waits, stalest first', async () => {
  const many = Array.from({ length: 100 }, (_, i) => String(880000000000 + i));
  const e = env({ export: many, manual: [] });
  const fx = fakeAfterShip();
  const first = await poll(e, fx);
  assert.equal(fx.calls.length, 40);
  assert.deepEqual([first.created, first.polled, first.waiting], [40, 40, 60]);
  assert.deepEqual(fx.creates().map((c) => c.number), many.slice(0, 40), 'in list order (none checked yet)');
  const second = await poll(e, fx, { now: NOW + 7200e3 });
  // A quarter of the budget is kept for reading the known 40 (one request); the other 39 add new numbers.
  assert.equal(fx.calls.length, 80);
  assert.equal(fx.lists().length, 1);
  assert.deepEqual(fx.creates().slice(40).map((c) => c.number), many.slice(40, 79), 'never-checked numbers first');
  assert.deepEqual([second.created, second.waiting], [39, 21]);
  const third = await poll(e, fx, { now: NOW + 4 * 3600e3 });
  assert.equal(third.waiting, 0);
  assert.equal(Object.keys(third.statuses).length, 100);
  // Per-check number cap: AFTERSHIP_MAX_PER_RUN.
  const e2 = env({ export: many, manual: [] }, { AFTERSHIP_MAX_PER_RUN: '10' });
  const fx2 = fakeAfterShip();
  const d2 = await poll(e2, fx2);
  assert.deepEqual([fx2.calls.length, d2.waiting], [10, 90]);
});

test('a refused key (401) records a plain lastError, keeps the last results and throws; nothing else is written', async () => {
  const e = env();
  const fx = fakeAfterShip();
  await poll(e, fx);
  const before = e.REPORT_STORE.json(INDEX_KEY);
  const bad = fakeAfterShip({ known: ALL, status: () => 401 });
  await assert.rejects(poll(e, bad, { now: NOW + 7200e3 }), (err) => err instanceof AfterShipError && /refused the API key/.test(err.message));
  assert.equal(bad.calls.length, 1, 'stops at the first refusal');
  const after = e.REPORT_STORE.json(INDEX_KEY);
  assert.deepEqual(after.statuses, before.statuses);
  assert.match(after.lastError.message, /AfterShip refused the API key\. Check AFTERSHIP_API_KEY/);
  assert.ok(!JSON.stringify(after).includes(KEY));
});

test('429 part-way: what was read is kept, lastError says why, the rest waits; a short window is waited out once', async () => {
  const e = env();
  const fx = fakeAfterShip({ status: (kind, n) => (kind === 'create' && n === 4 ? 429 : 200) });
  const doc = await poll(e, fx);
  assert.equal(doc.created, 3);
  assert.match(doc.lastError.message, /too many requests/);
  assert.equal(Object.keys(doc.statuses).length, 3);
  assert.equal(doc.waiting, ALL.length - 3);
  // Retry-After: 1 second -> waited and sent once more.
  const e2 = env({ export: [NUMBERS.transit], manual: [] });
  let first = true;
  const fx2 = fakeAfterShip({ retryAfter: '0', status: (kind) => (kind === 'create' && first ? ((first = false), 429) : 200) });
  const d2 = await poll(e2, fx2);
  assert.equal(fx2.calls.length, 2);
  assert.deepEqual([d2.created, d2.lastError], [1, undefined]);
  // 429 on the very first request: nothing read, so the check fails like a refused key.
  await assert.rejects(poll(env(), fakeAfterShip({ status: () => 429 })), /too many requests/);
});

test('per-number errors: a refused number is stored with a plain message and offered again a day later; 5xx is listed', async () => {
  const e = env({ export: [NUMBERS.transit, 'BAD000001'], manual: [] });
  const fx = fakeAfterShip({ refuse: ['BAD000001'] });
  const doc = await poll(e, fx);
  assert.deepEqual([doc.statuses.BAD000001.state, doc.statuses.BAD000001.error], ['', 'AfterShip does not recognise this tracking number.']);
  await poll(e, fx, { now: NOW + 7200e3 });
  assert.equal(fx.creates().filter((c) => c.number === 'BAD000001').length, 1, 'not offered again within a day');
  await poll(e, fx, { now: NOW + 25 * 3600e3 });
  assert.equal(fx.creates().filter((c) => c.number === 'BAD000001').length, 2);
  // A slug AfterShip refuses: added again without it.
  const e2 = env({ export: [NUMBERS.out], manual: [], carriers: { [NUMBERS.out]: 'UPS' } });
  const fx2 = fakeAfterShip({ badSlug: ['ups'] });
  const d2 = await poll(e2, fx2);
  assert.deepEqual(fx2.creates().map((c) => c.slug), ['ups', '']);
  assert.equal(d2.created, 1);
  // A server error on one create: listed in errors, the others go on.
  const e3 = env({ export: [NUMBERS.transit, NUMBERS.out], manual: [] });
  const fx3 = fakeAfterShip({ status: (kind, n) => (kind === 'create' && n === 1 ? 500 : 200) });
  const d3 = await poll(e3, fx3);
  assert.equal(d3.errors.length, 1);
  assert.match(d3.errors[0].message, /HTTP 500/);
  assert.equal(d3.created, 1);
});

test('a number AfterShip no longer has is added again at the next check; KV read failures write nothing', async () => {
  const e = env({ export: [NUMBERS.transit], manual: [] });
  const fx = fakeAfterShip();
  await poll(e, fx);
  fx.have.delete(NUMBERS.transit);
  await poll(e, fx, { now: NOW + 7200e3 });
  assert.equal(e.REPORT_STORE.json(IDS_KEY).ids[NUMBERS.transit], undefined);
  await poll(e, fx, { now: NOW + 4 * 3600e3 });
  assert.equal(fx.creates().length, 2);
  const broken = env();
  broken.REPORT_STORE.get = async () => { throw new Error('KV GET failed: 503'); };
  await assert.rejects(pollTracking(broken, { fetch: fx.fetch, now: NOW }), /could not be read/);
  assert.equal(broken.REPORT_STORE.puts.length, 0);
  await assert.rejects(pollTracking({ REPORT_STORE: memoryKv() }), /AFTERSHIP_API_KEY/);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
