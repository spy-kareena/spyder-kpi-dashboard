/**
 * AfterShip tracking for the Shipping page (see docs/SHIPPING.md). Needs the Workers KV namespace bound to this
 * Pages project as REPORT_STORE (the same one as functions/api/report.js). The password gate in
 * functions/_middleware.js runs first.
 *   GET  /api/shipping -> the last AfterShip results: {configured, store, active, polledAt, source, statuses, lastError,
 *                         errors, wanted:{exportAsOf, export, manual, updatedAt}, refreshAfter, schedule, everyHours}
 *                         configured: the AfterShip key is set here; active: a check ran in the last 6 hours (the
 *                         Worker can have the key without this site having it).
 *   PUT  /api/shipping -> body {asOf:'YYYY-MM-DD', export:[numbers], manual:[numbers], carriers?:{[number]: label}}:
 *                         the tracking numbers the page lists from the export and the ones added by hand, with the
 *                         carrier named by the SAP ship method (only known carriers become AfterShip slugs). An older
 *                         export never replaces a newer export's numbers. asOf must be a real date, at most two days
 *                         ahead.
 *   POST /api/shipping -> checks AfterShip now ("Refresh now"), at most once per 10 minutes for the whole site (a try
 *                         that failed can be repeated after 1 minute). Like each 2-hourly check it asks about the
 *                         numbers still moving, stalest first, within the per-check limits of shared/aftership.mjs.
 * The 2-hourly checks run in the scheduled Worker workers/shipping-poller. The AfterShip key (AFTERSHIP_API_KEY) is
 * only needed here for "Refresh now" and the configured flag; nothing here ever returns it.
 */
import {
  pollTracking, aftershipConfigured, cleanTrackingNumber, slugForCarrier, readJsonStrict, INDEX_KEY, WANTED_KEY, REFRESH_KEY,
  REFRESH_SECONDS, MAX_EXPORT, MAX_MANUAL, SCHEDULE,
} from '../../shared/aftership.mjs';

const MAX_BODY = 64 * 1024;
const MAX_LIST = 2000; // longer lists are refused rather than cut
const ACTIVE_HOURS = 6; // a check this recent means the Worker is running

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.REPORT_STORE;
  if (!['GET', 'PUT', 'POST'].includes(request.method)) return json(405, { error: 'Use GET, PUT or POST.' }, { Allow: 'GET, PUT, POST' });
  if (!store) return json(503, { configured: false, store: false, error: 'Shared storage is not set up on this site (REPORT_STORE).' });
  if (request.method === 'GET') return readStatuses(store, env);
  // The session cookie is SameSite=Lax, and only the dashboard page itself may change the list or spend AfterShip calls.
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json(403, { error: 'Cross-site request refused.' });
  if (request.method === 'PUT') return saveWanted(request, store);
  return refreshNow(store, env);
}

// Reads for showing: a failed KV read counts as nothing saved (no results yet, no Refresh now limit).
async function readJson(store, key) {
  try { return await store.get(key, { type: 'json' }); } catch (err) { return null; }
}
async function readText(store, key) {
  try { return await store.get(key); } catch (err) { return null; }
}

async function readStatuses(store, env) {
  const [index, wanted, last] = await Promise.all([readJson(store, INDEX_KEY), readJson(store, WANTED_KEY), readText(store, REFRESH_KEY)]);
  const i = index || {};
  const w = wanted || {};
  // Only AfterShip results: the FedEx results of an older version (no provider) are not shown.
  const ours = i.provider === 'aftership';
  const polledAt = ours ? String(i.polledAt || '') : '';
  const t = Date.parse(polledAt);
  return json(200, {
    configured: aftershipConfigured(env),
    store: true,
    active: Number.isFinite(t) && Date.now() - t < ACTIVE_HOURS * 3600 * 1000,
    polledAt,
    source: ours ? String(i.source || '') : '',
    statuses: ours && i.statuses && typeof i.statuses === 'object' ? i.statuses : {},
    errors: ours && Array.isArray(i.errors) ? i.errors : [],
    lastError: ours ? i.lastError || null : null,
    wanted: { exportAsOf: String(w.exportAsOf || ''), export: Array.isArray(w.export) ? w.export : [], manual: Array.isArray(w.manual) ? w.manual : [], updatedAt: String(w.updatedAt || '') },
    refreshAfter: refreshAfter(last),
    schedule: SCHEDULE,
    everyHours: 2,
  });
}

function refreshAfter(last, now = Date.now()) {
  const t = Date.parse(last || '');
  const until = t + REFRESH_SECONDS * 1000;
  return isFinite(t) && until > now ? new Date(until).toISOString() : '';
}

const cleanList = (list, max) => [...new Set(list.map(cleanTrackingNumber).filter(Boolean))].slice(0, max);
// An export date: a real calendar day from 2000 up to two days ahead (same rule as atRisk.asOf in report.js).
function exportDate(v) {
  const s = typeof v === 'string' ? v : '';
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s && s >= '2000-01-01' && t <= Date.now() + 2 * 864e5;
}
const sameList = (a, b) => {
  const x = [...(a || [])].sort(), y = [...(b || [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const sameMap = (a, b) => {
  const x = a && typeof a === 'object' ? a : {}, y = b && typeof b === 'object' ? b : {};
  const kx = Object.keys(x), ky = Object.keys(y);
  return kx.length === ky.length && kx.every((k) => x[k] === y[k]);
};

async function saveWanted(request, store) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json(413, { error: 'The tracking list is too large.' });
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'The tracking list is too large.' });
  let body;
  try { body = JSON.parse(text); } catch (err) { return json(400, { error: 'Send the tracking list as JSON.' }); }
  const asOf = String(body && body.asOf || '');
  if (!exportDate(asOf)) return json(400, { error: 'asOf must be the export date (YYYY-MM-DD).' });
  if (!Array.isArray(body.export) || !Array.isArray(body.manual)) return json(400, { error: 'export and manual must be lists of tracking numbers.' });
  if (body.export.length > MAX_LIST || body.manual.length > MAX_LIST) return json(413, { error: 'Too many tracking numbers.' });
  const exp = cleanList(body.export, MAX_EXPORT);
  const manual = cleanList(body.manual, MAX_MANUAL);
  let prev;
  // A failed read must not lead to a fresh list being written over the stored one.
  try { prev = (await readJsonStrict(store, WANTED_KEY)) || {}; } catch (err) {
    return json(500, { error: 'The stored tracking list could not be read. Nothing was changed; try again in a minute.' });
  }
  // A browser that still has an older export open must not replace the numbers of a newer one. A stored date that
  // is not a real export date (in the future) is ignored, so it can never freeze the list.
  const older = exportDate(prev.exportAsOf) && asOf < prev.exportAsOf;
  const next = {
    v: 1,
    exportAsOf: older ? prev.exportAsOf : asOf,
    export: older ? (Array.isArray(prev.export) ? prev.export : []) : exp,
    manual,
  };
  // Carrier labels, kept only for listed numbers and carriers with a known AfterShip slug (an older export keeps the
  // stored ones for its numbers).
  const listed = new Set([...next.export, ...manual]);
  const carriers = {};
  const sent = body.carriers && typeof body.carriers === 'object' && !Array.isArray(body.carriers) ? body.carriers : {};
  const prevCarriers = prev.carriers && typeof prev.carriers === 'object' ? prev.carriers : {};
  for (const [raw, label] of Object.entries(sent).slice(0, MAX_LIST)) {
    const n = cleanTrackingNumber(raw);
    if (n && listed.has(n) && slugForCarrier(String(label))) carriers[n] = String(label);
  }
  if (older) for (const n of next.export) if (prevCarriers[n] && !carriers[n]) carriers[n] = prevCarriers[n];
  next.carriers = carriers;
  const unchanged = next.exportAsOf === prev.exportAsOf && sameList(next.export, prev.export) && sameList(next.manual, prev.manual) && sameMap(next.carriers, prev.carriers);
  // One KV write only when something changed (every browser that opens the page sends the list).
  if (!unchanged) await store.put(WANTED_KEY, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }));
  return json(200, { saved: !unchanged, keptNewerExport: older, exportAsOf: next.exportAsOf, export: next.export.length, manual: next.manual.length });
}

async function refreshNow(store, env) {
  if (!aftershipConfigured(env)) {
    return json(503, { configured: false, error: 'The AfterShip key is not set up on this site yet (AFTERSHIP_API_KEY), so it cannot check now. The checks every 2 hours run if the shipping poller Worker has its key.' });
  }
  const now = Date.now();
  const after = refreshAfter(await readText(store, REFRESH_KEY), now);
  if (after) {
    const wait = Math.max(1, Math.ceil((Date.parse(after) - now) / 1000));
    return json(429, { error: `Refresh now was used less than 10 minutes ago. Try again in ${Math.ceil(wait / 60)} min.`, retryAfter: wait, refreshAfter: after }, { 'Retry-After': String(wait) });
  }
  // Taken before the check, so two quick clicks (or two people) never make two rounds of AfterShip calls. It holds for
  // 1 minute only (KV's shortest expiry) until the check has worked, so a check that fails, or that Cloudflare stops
  // part-way, never blocks the next try for 10 minutes. The stored time is set back so refreshAfter() gives retryAt.
  const retryAt = now + 60 * 1000;
  try { await store.put(REFRESH_KEY, new Date(retryAt - REFRESH_SECONDS * 1000).toISOString(), { expirationTtl: 60 }); } catch (err) { /* checked anyway */ }
  try {
    const doc = await pollTracking(env, { now, source: 'refresh' });
    try { await store.put(REFRESH_KEY, new Date(now).toISOString(), { expirationTtl: REFRESH_SECONDS }); } catch (err) { /* the 1-minute hold stays */ }
    return json(200, { polledAt: doc.polledAt, statuses: doc.statuses, errors: doc.errors, lastError: doc.lastError || null, count: doc.count, polled: doc.polled, created: doc.created, waiting: doc.waiting, refreshAfter: refreshAfter(new Date(now).toISOString(), now) });
  } catch (err) {
    return json(err && err.status === 503 ? 503 : 502, { error: String(err && err.message || 'AfterShip tracking failed.'), refreshAfter: new Date(retryAt).toISOString() });
  }
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  });
}
