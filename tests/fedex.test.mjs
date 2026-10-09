// Tests for shared/fedex.mjs (FedEx sign-in, Track API batches, normalizing answers, the 4-hourly check).
// Run: node tests/fedex.test.mjs. FedEx and Workers KV are stand-ins (tests/fedex-fixtures.mjs); nothing leaves the machine.
import assert from 'node:assert/strict';
import { memoryKv, fakeFedex, trackResponse, RESULTS, NUMBERS } from './fedex-fixtures.mjs';
import {
  normalizeTrackResponse, normalizeTrackResult, trackNumbers, getFedexToken, pollTracking, wantedNumbers, cleanTrackingNumber,
  splitTrackingNumbers, fedexBase, FedexError, TRACK_BATCH, INDEX_KEY, WANTED_KEY, TOKEN_KEY,
} from '../shared/fedex.mjs';

const NOW = Date.parse('2026-10-09T16:00:00Z');
const env = (extra = {}) => ({ REPORT_STORE: memoryKv(), FEDEX_CLIENT_ID: 'test-client-id', FEDEX_CLIENT_SECRET: 'test-client-secret-value', FEDEX_API_BASE: 'https://apis-sandbox.fedex.com', ...extra });
const one = (key) => normalizeTrackResponse(trackResponse([NUMBERS[key]]), NOW).statuses[NUMBERS[key]];

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('parcel in transit: stage, last scan, ETA and carrier', () => {
  const s = one('parcel');
  assert.equal(s.number, '770012345678');
  assert.equal(s.carrier, 'FedEx');
  assert.equal(s.stage, 'inTransit');
  assert.equal(s.reached, 'inTransit');
  assert.equal(s.status, 'In transit');
  assert.deepEqual(s.lastEvent, { at: '2026-10-08T06:10:00-06:00', city: 'Regina, SK, CA', desc: 'Arrived at FedEx location' });
  assert.equal(s.eta, '2026-10-12T17:00:00-05:00');
  assert.equal(s.shippedAt, '2026-10-06T00:00:00-06:00');
  assert.equal(s.deliveredAt, '');
  assert.deepEqual(s.customs, []);
  assert.equal(s.customsState, '');
  assert.equal(s.exception, null);
  assert.deepEqual([s.originCountry, s.destCountry], ['CA', 'CA']);
  assert.equal(s.checkedAt, new Date(NOW).toISOString());
});

test('FedEx Freight LTL is told apart from parcel and is out for delivery', () => {
  const s = one('freight');
  assert.equal(s.carrier, 'FedEx Freight');
  assert.equal(s.service, 'FedEx Freight Economy');
  assert.equal(s.stage, 'outForDelivery');
  assert.equal(s.reached, 'outForDelivery');
  // "International Economy Freight" style names on Express stay plain FedEx
  const express = normalizeTrackResult({ ...RESULTS.parcel, serviceDetail: { type: 'INTERNATIONAL_ECONOMY_FREIGHT', description: 'FedEx International Economy Freight' } }, 'X', NOW);
  assert.equal(express.carrier, 'FedEx');
});

test('customs delay: stage customs, clearance delay with the reason, customs scans oldest first', () => {
  const s = one('customsDelay');
  assert.equal(s.stage, 'customs');
  assert.equal(s.customsState, 'delay');
  assert.equal(s.reached, 'customs');
  assert.deepEqual(s.exception, { code: 'CD', desc: 'Missing commercial invoice', action: 'The shipper must send the commercial invoice' });
  assert.deepEqual(s.customs.map((e) => e.code), ['CP', 'CD']);
  assert.equal(s.customsStart, '2026-10-06T22:00:00-04:00');
  assert.equal(s.customsEnd, '');
  assert.deepEqual([s.originCountry, s.destCountry], ['CA', 'US']);
});

test('delivery exception keeps how far it got (out for delivery) and why', () => {
  const s = one('exception');
  assert.equal(s.stage, 'exception');
  assert.equal(s.reached, 'outForDelivery');
  assert.equal(s.exception.code, 'DE');
  assert.equal(s.exception.desc, 'Customer not available or business closed');
  assert.equal(s.exception.action, 'We will try again on the next business day');
  assert.match(s.lastEvent.desc, /Delivery exception/);
});

test('delivered after customs: delivered time, customs released with its release time', () => {
  const s = one('delivered');
  assert.equal(s.stage, 'delivered');
  assert.equal(s.reached, 'delivered');
  assert.equal(s.deliveredAt, '2026-10-08T10:12:00-04:00');
  assert.equal(s.customsState, 'released');
  assert.equal(s.customsStart, '2026-10-05T18:00:00-04:00');
  assert.equal(s.customsEnd, '2026-10-06T08:00:00-04:00');
  assert.equal(s.exception, null);
});

test('a number FedEx does not know yet is "not found", not an error; unknown codes fall back to the text', () => {
  const s = normalizeTrackResponse(trackResponse(['123456789999']), NOW).statuses['123456789999'];
  assert.equal(s.notFound, true);
  assert.equal(s.stage, 'label');
  assert.equal(s.status, 'Not found at FedEx yet');
  const odd = normalizeTrackResult({ latestStatusDetail: { code: 'ZZ', description: 'Delivered to mailroom' }, scanEvents: [] }, 'X', NOW);
  assert.equal(odd.stage, 'delivered');
  assert.equal(normalizeTrackResult({ latestStatusDetail: { code: 'ZZ', description: 'Weather delay' } }, 'X', NOW).stage, 'exception');
});

test('tracking numbers are cleaned; one SAP field can hold several', () => {
  assert.equal(cleanTrackingNumber(' 7700 1234 5678 '), '770012345678');
  assert.equal(cleanTrackingNumber('abc'), '');
  assert.equal(cleanTrackingNumber('<script>'), '');
  assert.deepEqual(splitTrackingNumbers('7700 1234 5678, 7700-1234-5679; 7700 1234 5678'), ['770012345678', '770012345679']);
  assert.deepEqual(splitTrackingNumbers(''), []);
  assert.deepEqual(wantedNumbers({ export: ['770012345678', 'bad', '770012345678'], manual: ['1234567890'] }), ['770012345678', '1234567890']);
});

test('sign-in token is cached in KV until a minute before it ends; a new key or an expired token signs in again', async () => {
  const e = env();
  const fx = fakeFedex();
  const a = await getFedexToken(e, { fetch: fx.fetch, now: NOW });
  const b = await getFedexToken(e, { fetch: fx.fetch, now: NOW + 30 * 60 * 1000 });
  assert.equal(a, b);
  assert.equal(fx.tokens(), 1);
  assert.equal(fx.calls[0].url, 'https://apis-sandbox.fedex.com/oauth/token');
  assert.match(fx.calls[0].body, /grant_type=client_credentials/);
  assert.ok(e.REPORT_STORE.ttl[TOKEN_KEY] >= 60, 'the cached token expires on its own');
  await getFedexToken(e, { fetch: fx.fetch, now: NOW + 59 * 60 * 1000 + 30000 });
  assert.equal(fx.tokens(), 2, 'less than a minute left: signs in again');
  await getFedexToken({ ...e, FEDEX_CLIENT_ID: 'another-client' }, { fetch: fx.fetch, now: NOW + 59 * 60 * 1000 + 31000 });
  assert.equal(fx.tokens(), 3, 'a changed API key never reuses the old token');
});

test('a refused key gives a plain message without the secret; missing keys are a 503', async () => {
  const fx = fakeFedex({ tokenStatus: 401 });
  await assert.rejects(getFedexToken(env(), { fetch: fx.fetch, now: NOW }), (err) => err instanceof FedexError && /refused the API key/.test(err.message) && !/test-client-secret/.test(err.message));
  await assert.rejects(getFedexToken(env({ FEDEX_CLIENT_SECRET: '' }), { fetch: fx.fetch }), (err) => err.status === 503);
  assert.equal(fedexBase({}), 'https://apis.fedex.com');
  assert.equal(fedexBase({ FEDEX_API_BASE: 'http://evil.example' }), 'https://apis.fedex.com', 'only https bases are used');
});

test('numbers go to FedEx 30 at a time with detailed scans; a refused token is replaced once and the batch retried', async () => {
  const e = env();
  const fx = fakeFedex();
  const numbers = Array.from({ length: 65 }, (_, i) => String(880000000000 + i));
  const out = await trackNumbers([...numbers, numbers[0]], e, { fetch: fx.fetch, now: NOW });
  const tracks = fx.calls.filter((c) => c.kind === 'track');
  assert.equal(TRACK_BATCH, 30);
  assert.deepEqual(tracks.map((c) => c.numbers.length), [30, 30, 5]);
  assert.ok(tracks.every((c) => c.detailed === true && c.url === 'https://apis-sandbox.fedex.com/track/v1/trackingnumbers' && /^Bearer tok-1$/.test(c.auth)));
  assert.equal(Object.keys(out.statuses).length, 65);
  assert.deepEqual(out.errors, []);

  fx.revoke();
  const again = await trackNumbers([NUMBERS.parcel], e, { fetch: fx.fetch, now: NOW + 60000 });
  assert.equal(again.statuses[NUMBERS.parcel].stage, 'inTransit');
  assert.equal(fx.tokens(), 2);
});

test('a failed batch is reported and the other batches still come back', async () => {
  const fx = fakeFedex({ trackStatus: (n) => (n === 1 ? 503 : 200) });
  const numbers = Array.from({ length: 35 }, (_, i) => String(880000000000 + i));
  const out = await trackNumbers(numbers, env(), { fetch: fx.fetch, now: NOW });
  assert.equal(Object.keys(out.statuses).length, 5);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0].message, /HTTP 503\): Service unavailable/);
});

test('a check tracks the wanted numbers, skips delivered ones next time and keeps recent deliveries', async () => {
  const e = env();
  const fx = fakeFedex();
  await e.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ v: 1, exportAsOf: '2026-10-08', export: [NUMBERS.parcel, NUMBERS.delivered, NUMBERS.customsDelay], manual: [NUMBERS.freight] }));
  const first = await pollTracking(e, { fetch: fx.fetch, now: NOW, source: 'cron' });
  assert.equal(first.polledAt, new Date(NOW).toISOString());
  assert.equal(first.count, 4);
  assert.deepEqual(Object.keys(first.statuses).sort(), [NUMBERS.parcel, NUMBERS.delivered, NUMBERS.customsDelay, NUMBERS.freight].sort());
  assert.deepEqual(e.REPORT_STORE.json(INDEX_KEY).statuses[NUMBERS.delivered].stage, 'delivered');

  // Next check: the delivered number is final and is not asked again. Dropping numbers from the list:
  // the delivered one stays (recent delivery), the one still moving is dropped.
  await e.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ v: 1, export: [NUMBERS.customsDelay], manual: [] }));
  fx.calls.length = 0;
  const second = await pollTracking(e, { fetch: fx.fetch, now: NOW + 4 * 3600e3 });
  assert.deepEqual(fx.calls.filter((c) => c.kind === 'track').flatMap((c) => c.numbers), [NUMBERS.customsDelay]);
  assert.deepEqual(Object.keys(second.statuses).sort(), [NUMBERS.delivered, NUMBERS.customsDelay].sort());
  // 46 days after delivery the delivered status is dropped too.
  const late = await pollTracking(e, { fetch: fx.fetch, now: Date.parse('2026-11-24T00:00:00Z') });
  assert.deepEqual(Object.keys(late.statuses), [NUMBERS.customsDelay]);
});

test('when FedEx cannot be used the previous results stay, lastError says why, and the error is thrown', async () => {
  const e = env();
  await e.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ export: [NUMBERS.parcel] }));
  await pollTracking(e, { fetch: fakeFedex().fetch, now: NOW });
  const before = e.REPORT_STORE.json(INDEX_KEY);
  await assert.rejects(pollTracking({ ...e, FEDEX_CLIENT_SECRET: 'rotated-secret' }, { fetch: fakeFedex({ tokenStatus: 401 }).fetch, now: NOW + 1000 }), FedexError);
  const after = e.REPORT_STORE.json(INDEX_KEY);
  assert.equal(after.polledAt, before.polledAt);
  assert.deepEqual(after.statuses, before.statuses);
  assert.match(after.lastError.message, /refused the API key/);
  assert.ok(!JSON.stringify(after).includes('rotated-secret'));
  await assert.rejects(pollTracking({ REPORT_STORE: memoryKv() }, {}), (err) => err.status === 503);
  await assert.rejects(pollTracking({}, {}), (err) => err.status === 503);
});

test('an empty list needs no FedEx call', async () => {
  const e = env();
  const fx = fakeFedex();
  const doc = await pollTracking(e, { fetch: fx.fetch, now: NOW });
  assert.equal(fx.calls.length, 0);
  assert.deepEqual(doc.statuses, {});
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
