/**
 * Live FedEx shipping for the Shipping page (see docs/SHIPPING.md). Needs the Workers KV namespace bound to this
 * Pages project as REPORT_STORE (the same one as functions/api/report.js). The password gate in
 * functions/_middleware.js runs first.
 *   GET  /api/shipping -> the last FedEx results: {configured, fedex, polledAt, statuses, lastError, errors,
 *                         wanted:{exportAsOf, export, manual, updatedAt}, refreshAfter, schedule}
 *   PUT  /api/shipping -> body {asOf:'YYYY-MM-DD', export:[numbers], manual:[numbers]}: the tracking numbers the page
 *                         picked from the export (deliveries of the last 30 days that are not long delivered) and the
 *                         ones added by hand. An older export never replaces a newer export's numbers.
 *   POST /api/shipping -> checks FedEx now ("Refresh now"), at most once per 10 minutes for the whole site.
 * The 4-hourly checks run in the scheduled Worker workers/shipping-poller. FedEx keys (FEDEX_CLIENT_ID,
 * FEDEX_CLIENT_SECRET, optional FEDEX_API_BASE) are only needed here for "Refresh now"; without them it answers 503.
 * Nothing here ever returns the keys or the FedEx sign-in token.
 */
import {
  pollTracking, fedexConfigured, cleanTrackingNumber, INDEX_KEY, WANTED_KEY, REFRESH_KEY, REFRESH_SECONDS, MAX_EXPORT, MAX_MANUAL,
} from '../../shared/fedex.mjs';

const MAX_BODY = 64 * 1024;
const MAX_LIST = 2000; // longer lists are refused rather than cut
const SCHEDULE = '0 */4 * * *'; // keep in step with workers/shipping-poller/wrangler.toml

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.REPORT_STORE;
  if (!['GET', 'PUT', 'POST'].includes(request.method)) return json(405, { error: 'Use GET, PUT or POST.' }, { Allow: 'GET, PUT, POST' });
  if (!store) return json(503, { configured: false, error: 'Shared storage is not set up on this site (REPORT_STORE).' });
  if (request.method === 'GET') return readStatuses(store, env);
  // The session cookie is SameSite=Lax, and only the dashboard page itself may change the list or spend FedEx calls.
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json(403, { error: 'Cross-site request refused.' });
  if (request.method === 'PUT') return saveWanted(request, store);
  return refreshNow(store, env);
}

async function readJson(store, key) {
  try { return await store.get(key, { type: 'json' }); } catch (err) { return null; }
}

async function readStatuses(store, env) {
  const [index, wanted, last] = await Promise.all([readJson(store, INDEX_KEY), readJson(store, WANTED_KEY), store.get(REFRESH_KEY)]);
  const i = index || {};
  const w = wanted || {};
  return json(200, {
    configured: true,
    fedex: fedexConfigured(env),
    polledAt: String(i.polledAt || ''),
    source: String(i.source || ''),
    statuses: i.statuses && typeof i.statuses === 'object' ? i.statuses : {},
    errors: Array.isArray(i.errors) ? i.errors : [],
    lastError: i.lastError || null,
    wanted: { exportAsOf: String(w.exportAsOf || ''), export: Array.isArray(w.export) ? w.export : [], manual: Array.isArray(w.manual) ? w.manual : [], updatedAt: String(w.updatedAt || '') },
    refreshAfter: refreshAfter(last),
    schedule: SCHEDULE,
  });
}

function refreshAfter(last, now = Date.now()) {
  const t = Date.parse(last || '');
  const until = t + REFRESH_SECONDS * 1000;
  return isFinite(t) && until > now ? new Date(until).toISOString() : '';
}

const cleanList = (list, max) => [...new Set(list.map(cleanTrackingNumber).filter(Boolean))].slice(0, max);
const sameList = (a, b) => {
  const x = [...(a || [])].sort(), y = [...(b || [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

async function saveWanted(request, store) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json(413, { error: 'The tracking list is too large.' });
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'The tracking list is too large.' });
  let body;
  try { body = JSON.parse(text); } catch (err) { return json(400, { error: 'Send the tracking list as JSON.' }); }
  const asOf = String(body && body.asOf || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !isFinite(Date.parse(asOf))) return json(400, { error: 'asOf must be the export date (YYYY-MM-DD).' });
  if (!Array.isArray(body.export) || !Array.isArray(body.manual)) return json(400, { error: 'export and manual must be lists of tracking numbers.' });
  if (body.export.length > MAX_LIST || body.manual.length > MAX_LIST) return json(413, { error: 'Too many tracking numbers.' });
  const exp = cleanList(body.export, MAX_EXPORT);
  const manual = cleanList(body.manual, MAX_MANUAL);
  const prev = (await readJson(store, WANTED_KEY)) || {};
  // A browser that still has an older export open must not replace the numbers of a newer one.
  const older = !!prev.exportAsOf && asOf < prev.exportAsOf;
  const next = {
    v: 1,
    exportAsOf: older ? prev.exportAsOf : asOf,
    export: older ? (Array.isArray(prev.export) ? prev.export : []) : exp,
    manual,
  };
  const unchanged = next.exportAsOf === prev.exportAsOf && sameList(next.export, prev.export) && sameList(next.manual, prev.manual);
  // One KV write only when something changed (every browser that opens the page sends the list).
  if (!unchanged) await store.put(WANTED_KEY, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }));
  return json(200, { saved: !unchanged, keptNewerExport: older, exportAsOf: next.exportAsOf, export: next.export.length, manual: next.manual.length });
}

async function refreshNow(store, env) {
  if (!fedexConfigured(env)) {
    return json(503, { configured: true, fedex: false, error: 'FedEx keys are not set up on this site yet (FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET), so it cannot check now. The checks every 4 hours run if the shipping poller Worker has its keys.' });
  }
  const now = Date.now();
  const after = refreshAfter(await store.get(REFRESH_KEY), now);
  if (after) {
    const wait = Math.max(1, Math.ceil((Date.parse(after) - now) / 1000));
    return json(429, { error: `FedEx was checked less than 10 minutes ago. Try again in ${Math.ceil(wait / 60)} min.`, retryAfter: wait, refreshAfter: after }, { 'Retry-After': String(wait) });
  }
  // Taken before the check, so two quick clicks (or two people) never make two rounds of FedEx calls.
  await store.put(REFRESH_KEY, new Date(now).toISOString(), { expirationTtl: REFRESH_SECONDS });
  try {
    const doc = await pollTracking(env, { now, source: 'refresh' });
    return json(200, { polledAt: doc.polledAt, statuses: doc.statuses, errors: doc.errors, count: doc.count, polled: doc.polled, refreshAfter: refreshAfter(new Date(now).toISOString(), now) });
  } catch (err) {
    return json(err && err.status === 503 ? 503 : 502, { error: String(err && err.message || 'FedEx tracking failed.') });
  }
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  });
}
