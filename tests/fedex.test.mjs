// Tests for shared/fedex.mjs (FedEx sign-in, Track API batches, normalizing answers, the 4-hourly check).
// Run: node tests/fedex.test.mjs. FedEx and Workers KV are stand-ins (tests/fedex-fixtures.mjs); nothing leaves the machine.
import assert from 'node:assert/strict';
import { memoryKv, fakeFedex, trackResponse, RESULTS, NUMBERS } from './fedex-fixtures.mjs';
import {
  normalizeTrackResponse, normalizeTrackResult, trackNumbers, getFedexToken, pollTracking, wantedNumbers, cleanTrackingNumber,
  splitTrackingNumbers, fedexBase, FedexError, TRACK_BATCH, INDEX_KEY, WANTED_KEY, TOKEN_KEY, MAX_PER_RUN, MAX_TRACKED, maxPerRun,
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
  // Words typed into TrackNo have no digit, so they are not tracking numbers (and never go to FedEx).
  assert.equal(cleanTrackingNumber('Customer Pickup'), '');
  assert.equal(cleanTrackingNumber('Will Call'), '');
  assert.equal(cleanTrackingNumber('PU 123456'), 'PU123456');
  assert.deepEqual(splitTrackingNumbers('Customer Pickup, 7700 1234 5678'), ['770012345678']);
  assert.deepEqual(splitTrackingNumbers('7700 1234 5678, 7700-1234-5679; 7700 1234 5678'), ['770012345678', '770012345679']);
  assert.deepEqual(splitTrackingNumbers(''), []);
  // Two whole numbers with only a space (or &, +, "and") between them are two numbers; grouped digits stay one.
  assert.deepEqual(splitTrackingNumbers('770012345678 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(splitTrackingNumbers('770012345678 & 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(splitTrackingNumbers('770012345678 and 770012345679'), ['770012345678', '770012345679']);
  assert.deepEqual(splitTrackingNumbers('770012345678 AND 7700-1234-5679 + 1234567890'), ['770012345678', '770012345679', '1234567890']);
  assert.deepEqual(splitTrackingNumbers('7700 1234 5678'), ['770012345678']);
  assert.deepEqual(splitTrackingNumbers('7700 1234 5678 and 7700 1234 5679'), ['770012345678', '770012345679']);
  assert.deepEqual(splitTrackingNumbers('7700-1234-5678 7700-1234-5679'), ['770012345678', '770012345679']);
  assert.deepEqual(splitTrackingNumbers('SANDBOX123'), ['SANDBOX123'], '"and" inside a number is not a separator');
  assert.deepEqual(wantedNumbers({ export: ['770012345678', 'bad', '770012345678'], manual: ['1234567890'] }), ['1234567890', '770012345678'], 'hand-added numbers first');
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

test('a FedEx sign-in failure after a batch came back keeps that batch and reports the rest', async () => {
  const fx = fakeFedex();
  let tracks = 0;
  let broken = false;
  // The first batch works; then the token is revoked and FedEx refuses a new sign-in.
  const fetch = async (url, init) => {
    if (broken && url.endsWith('/oauth/token')) return Response.json({ errors: [{ message: 'no' }] }, { status: 401 });
    const res = await fx.fetch(url, init);
    if (url.endsWith('/track/v1/trackingnumbers') && ++tracks === 1) { fx.revoke(); broken = true; }
    return res;
  };
  const numbers = Array.from({ length: 50 }, (_, i) => String(880000000000 + i));
  const out = await trackNumbers(numbers, env(), { fetch, now: NOW });
  assert.equal(Object.keys(out.statuses).length, 30);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].numbers, 20);
  assert.match(out.errors[0].message, /refused the API key/);

  // pollTracking saves what came back.
  const e = env();
  await e.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ export: numbers }));
  tracks = 0; broken = false;
  const doc = await pollTracking(e, { fetch, now: NOW });
  assert.equal(Object.keys(e.REPORT_STORE.json(INDEX_KEY).statuses).length, 30);
  assert.equal(doc.errors.length, 1);
  // Nothing back at all still throws, as before.
  await assert.rejects(trackNumbers(numbers, env(), { fetch: fakeFedex({ tokenStatus: 401 }).fetch, now: NOW }), FedexError);
});

test('a check asks FedEx about at most 60 numbers, never-checked first, then the oldest check', async () => {
  const e = env();
  const fx = fakeFedex();
  const numbers = Array.from({ length: 130 }, (_, i) => String(880000000000 + i));
  await e.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ export: numbers }));
  const asked = () => { const n = fx.calls.filter((c) => c.kind === 'track').flatMap((c) => c.numbers); fx.calls.length = 0; return n; };
  assert.equal(MAX_PER_RUN, 60);
  const first = await pollTracking(e, { fetch: fx.fetch, now: NOW });
  assert.deepEqual(asked(), numbers.slice(0, 60), 'two FedEx calls, the list order');
  assert.deepEqual([first.count, first.polled, first.waiting], [130, 60, 70]);
  assert.equal(Object.keys(first.statuses).length, 60, 'what came back is saved');
  const second = await pollTracking(e, { fetch: fx.fetch, now: NOW + 3600e3 });
  assert.deepEqual(asked(), numbers.slice(60, 120), 'numbers never checked come next');
  assert.equal(Object.keys(second.statuses).length, 120);
  const third = await pollTracking(e, { fetch: fx.fetch, now: NOW + 7200e3 });
  assert.deepEqual(asked(), [...numbers.slice(120), ...numbers.slice(0, 50)], 'then the ones checked longest ago');
  assert.equal(Object.keys(third.statuses).length, 130);
  // More per check where the Worker has the CPU time (Workers Paid); capped at the list size.
  await pollTracking({ ...e, FEDEX_MAX_PER_RUN: '600' }, { fetch: fx.fetch, now: NOW + 9000e3 });
  assert.equal(asked().length, 130);
  assert.equal(maxPerRun({ FEDEX_MAX_PER_RUN: '5000' }), 600);
  assert.equal(maxPerRun({ FEDEX_MAX_PER_RUN: 'x' }), 60);
});

test('delivered export numbers never crowd out hand-added ones: the 600 cap counts only numbers still moving', async () => {
  const e = env();
  const fx = fakeFedex();
  const exp = Array.from({ length: 500 }, (_, i) => String(880000000000 + i));
  const manual = Array.from({ length: 150 }, (_, i) => String(990000000000 + i));
  const delivered = (n) => ({ number: n, stage: 'delivered', deliveredAt: new Date(NOW - 2 * 864e5).toISOString(), checkedAt: new Date(NOW - 3600e3).toISOString() });
  await e.REPORT_STORE.put(INDEX_KEY, JSON.stringify({ v: 1, statuses: Object.fromEntries(exp.map((n) => [n, delivered(n)])) }));
  await e.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ v: 1, export: exp, manual }));
  assert.equal(MAX_TRACKED, 600);
  assert.equal(wantedNumbers({ export: exp, manual }).length, 650, 'the whole list, hand-added first');
  const asked = () => { const n = fx.calls.filter((c) => c.kind === 'track').flatMap((c) => c.numbers); fx.calls.length = 0; return n; };
  // Workers Paid (the whole list each check): every hand-added number, none of the delivered ones.
  const doc = await pollTracking({ ...e, FEDEX_MAX_PER_RUN: '600' }, { fetch: fx.fetch, now: NOW });
  assert.deepEqual(asked(), manual);
  assert.deepEqual([doc.count, doc.polled, doc.waiting], [650, 150, 0]);
  assert.equal(Object.keys(doc.statuses).length, 650, 'the delivered statuses are kept');
  // Free plan: 60 per check, hand-added first.
  const e2 = env();
  await e2.REPORT_STORE.put(INDEX_KEY, JSON.stringify({ v: 1, statuses: Object.fromEntries(exp.map((n) => [n, delivered(n)])) }));
  await e2.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ v: 1, export: exp, manual }));
  const free = await pollTracking(e2, { fetch: fx.fetch, now: NOW });
  assert.deepEqual(asked(), manual.slice(0, 60));
  assert.equal(free.waiting, 90);
  // 700 numbers all still moving: 600 are tracked (the 200 hand-added, then the newest 400 of the export).
  const e3 = env();
  const manual200 = Array.from({ length: 200 }, (_, i) => String(990000000000 + i));
  await e3.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ v: 1, export: exp, manual: manual200 }));
  const full = await pollTracking({ ...e3, FEDEX_MAX_PER_RUN: '600' }, { fetch: fx.fetch, now: NOW });
  assert.deepEqual(asked(), [...manual200, ...exp.slice(0, 400)]);
  assert.deepEqual([full.count, full.polled, full.waiting], [700, 600, 0]);
});

test('a failed KV read stops the check before anything is written over the stored list or results', async () => {
  const e = env();
  await e.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ export: [NUMBERS.parcel, NUMBERS.freight] }));
  await pollTracking(e, { fetch: fakeFedex().fetch, now: NOW });
  const before = e.REPORT_STORE.map.get(INDEX_KEY);
  const realGet = e.REPORT_STORE.get;
  for (const failing of [WANTED_KEY, INDEX_KEY]) {
    e.REPORT_STORE.get = async (key, opts) => { if (key === failing) throw new Error('KV GET failed: 503'); return realGet(key, opts); };
    const writes = e.REPORT_STORE.puts.length;
    const fx = fakeFedex();
    await assert.rejects(pollTracking(e, { fetch: fx.fetch, now: NOW + 1000 }), (err) => err instanceof FedexError && err.status === 503 && /could not be read/.test(err.message));
    assert.equal(e.REPORT_STORE.puts.length, writes, `${failing}: nothing written`);
    assert.equal(fx.calls.length, 0, `${failing}: FedEx not asked`);
  }
  e.REPORT_STORE.get = realGet;
  assert.equal(e.REPORT_STORE.map.get(INDEX_KEY), before);
  // A stored value that is not JSON is treated as nothing saved (it could never be read), not as a failure.
  e.REPORT_STORE.map.set(INDEX_KEY, '{broken');
  const doc = await pollTracking(e, { fetch: fakeFedex().fetch, now: NOW + 2000 });
  assert.equal(Object.keys(doc.statuses).length, 2);
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
