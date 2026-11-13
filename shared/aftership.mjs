/**
 * AfterShip tracking for the Shipping page. One copy of this code is used by both:
 *   - the scheduled Worker workers/shipping-poller (checks every 2 hours), and
 *   - the Pages Function functions/api/shipping.js (the page reads the results; "Refresh now").
 * No dependencies; plain fetch on Cloudflare Workers and Node.js 20 or newer. See docs/SHIPPING.md.
 *
 * AfterShip Tracking API, version 2026-07 (https://api.aftership.com, header as-api-key):
 *   POST /tracking/2026-07/trackings   adds one tracking number (AfterShip works out the carrier when no slug is sent)
 *   GET  /tracking/2026-07/trackings   lists trackings; tracking_numbers=a,b,c (up to LIST_BATCH), limit (up to 200),
 *                                      cursor (next page, from data.pagination.next_cursor)
 * Answers are {meta:{code, message, type}, data}. meta.code 4003 = the tracking already exists; 401 = the key is
 * refused; 429 = too many requests (X-RateLimit-Reset is the Unix time the 1-second window ends).
 * Secret: AFTERSHIP_API_KEY (a Worker secret and a Pages secret). It is only ever sent to AfterShip and never
 * returned to the page.
 *
 * Workers KV keys (the namespace bound as REPORT_STORE, next to the shared report):
 *   tracking:wanted     {v, updatedAt, exportAsOf, export:[numbers], manual:[numbers], carriers:{[number]: label}}
 *                       what to track (sent by the page)
 *   tracking:index      {v, provider, polledAt, source, count, polled, created, waiting, statuses:{[number]: status},
 *                       errors, lastError}  the results the page reads
 *   tracking:aftership  {v, ids:{[number]: {id, slug, at} | {failedAt, error}}}  numbers already added to AfterShip
 *   tracking:refresh    time of the last "Refresh now" (the 10-minute limit)
 *
 * A status (one per tracking number, see normalizeTracking):
 *   {number, id, slug, carrier, tag, subtag, status, detail, state:'shipped'|'transit'|'delayed'|'delivered'|'',
 *    stage (the older shape: 'label'|'inTransit'|'outForDelivery'|'exception'|'delivered'), lastEvent:{at, city, desc}|null,
 *    eta, deliveredAt, shippedAt, originCountry, destCountry, destCity, destState, destRaw, changedAt, updatedAt,
 *    notFound, error, checkedAt}
 * destCity / destState: the carrier's destination city and state or province; destRaw: the destination as the carrier
 * writes it ("ELKHART, IN, US"), when it gives no city on its own ('' when the carrier gives none). The page's Order Map
 * places a shipment with them.
 * changedAt is the time of the newest carrier event (the page lets a newer hand-set status win over an older one).
 */

export const AFTERSHIP_BASE = 'https://api.aftership.com';
export const TRACKINGS_PATH = '/tracking/2026-07/trackings';
export const WANTED_KEY = 'tracking:wanted';
export const INDEX_KEY = 'tracking:index';
export const IDS_KEY = 'tracking:aftership';
export const REFRESH_KEY = 'tracking:refresh';
export const REFRESH_SECONDS = 10 * 60; // "Refresh now" at most once per 10 minutes
export const SCHEDULE = '0 */2 * * *'; // keep in step with workers/shipping-poller/wrangler.toml
export const MAX_EXPORT = 500; // numbers from the export, newest first
export const MAX_MANUAL = 200; // numbers added by hand
// Numbers still moving that are tracked (hand-added first). Delivered numbers are never asked again, so they do not
// count toward it.
export const MAX_TRACKED = 600;
export const LIST_BATCH = 50; // tracking numbers per list request (the API's limit for tracking_numbers)
export const PAGE_LIMIT = 200; // trackings per page of a list request (the API's largest page)
// One check asks about at most MAX_PER_RUN numbers (stalest first) with at most MAX_CALLS AfterShip requests, so it
// fits the Workers Free plan (50 subrequests and 10 ms of CPU per run). The rest wait for the next check, 2 hours on.
// On Workers Paid, AFTERSHIP_MAX_PER_RUN and AFTERSHIP_MAX_CALLS raise them.
export const MAX_PER_RUN = 150;
export const MAX_CALLS = 40;
// Delivered statuses stay this long after delivery, even when no longer tracked (the page lists deliveries shipped
// in the 30 days before the export, and numbers added by hand for 45 days).
export const INDEX_KEEP_DAYS = 45;
export const RETRY_FAILED_HOURS = 24; // a number AfterShip refused is offered again a day later
export const TAGS = ['Pending', 'InfoReceived', 'InTransit', 'OutForDelivery', 'AttemptFail', 'Delivered', 'AvailableForPickup', 'Exception', 'Expired'];
// AfterShip tag -> the page's status.
export const TAG_STATE = {
  Pending: 'shipped', InfoReceived: 'shipped',
  InTransit: 'transit', OutForDelivery: 'transit', AvailableForPickup: 'transit',
  AttemptFail: 'delayed', Exception: 'delayed', Expired: 'delayed',
  Delivered: 'delivered',
};
export const TAG_TEXT = {
  Pending: 'Pending', InfoReceived: 'Label created', InTransit: 'In transit', OutForDelivery: 'Out for delivery',
  AttemptFail: 'Delivery attempt failed', Delivered: 'Delivered', AvailableForPickup: 'Ready for pickup',
  Exception: 'Exception', Expired: 'Tracking expired',
};
const TAG_STAGE = {
  Pending: 'label', InfoReceived: 'label', InTransit: 'inTransit', OutForDelivery: 'outForDelivery', AvailableForPickup: 'outForDelivery',
  AttemptFail: 'exception', Exception: 'exception', Expired: 'exception', Delivered: 'delivered',
};
// The page's carrier label (from the SAP ship method) -> the AfterShip courier slug. Only carriers with one obvious
// slug; any other carrier is left for AfterShip to work out from the number.
export const CARRIER_SLUGS = {
  'FedEx': 'fedex', 'FedEx Freight': 'fedex-freight', 'UPS': 'ups', 'Purolator': 'purolator', 'Canpar': 'canpar',
  'Canada Post': 'canada-post', 'Loomis': 'loomis-express',
};
const SLUG_NAMES = {
  fedex: 'FedEx', 'fedex-freight': 'FedEx Freight', ups: 'UPS', purolator: 'Purolator', canpar: 'Canpar', 'canada-post': 'Canada Post',
  'loomis-express': 'Loomis', dhl: 'DHL', 'dhl-global-mail': 'DHL eCommerce', usps: 'USPS', dayross: 'Day & Ross', dicom: 'Dicom',
};
const DAY = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 20000;

export class AfterShipError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'AfterShipError'; this.status = status; }
}

// Tracking numbers are letters and digits; spaces and dashes people type ("7700 1234 5678") are dropped.
// At least one digit: words typed into SAP TrackNo ("Customer Pickup", "Will Call") are not tracking numbers.
// Same rule as shipClean in index.html.
export function cleanTrackingNumber(v) {
  const s = String(v ?? '').replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z0-9]{6,40}$/.test(s) && /\d/.test(s) ? s : '';
}
// One SAP TrackNo field can hold more than one number: "7700 1234 5678, 7700 1234 5679", "770012345678 &
// 770012345679", "... and ...", or two whole numbers with only a space between them. A piece whose space-separated
// parts each have 10 or more letters and digits is several numbers; otherwise the parts are one grouped number.
// Same rule as shipSplit in index.html.
export function splitTrackingNumbers(v) {
  const pieces = String(v ?? '').split(/[,;/|&+\n\r]+|\band\b/i).flatMap((piece) => {
    const parts = piece.trim().split(/\s+/).filter(Boolean);
    return parts.length > 1 && parts.every((t) => t.replace(/-/g, '').length >= 10) ? parts : [piece];
  });
  return [...new Set(pieces.map(cleanTrackingNumber).filter(Boolean))];
}

export function aftershipConfigured(env) {
  return !!(env && String(env.AFTERSHIP_API_KEY || '').trim());
}
// Numbers asked per check and AfterShip requests per check (Workers Paid can raise both).
export function maxPerRun(env) {
  const n = Math.floor(Number(env && env.AFTERSHIP_MAX_PER_RUN));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_TRACKED) : MAX_PER_RUN;
}
export function maxCalls(env) {
  const n = Math.floor(Number(env && env.AFTERSHIP_MAX_CALLS));
  return Number.isFinite(n) && n >= 2 ? Math.min(n, 900) : MAX_CALLS;
}

async function readJson(kv, key) {
  try { return await kv.get(key, { type: 'json' }); } catch (err) { return null; }
}
// For read-modify-write: a failed KV read throws, so the caller stops instead of writing a fresh document over
// the stored one. A value that is not JSON (it cannot be read now or later) counts as nothing saved.
export async function readJsonStrict(kv, key) {
  const text = await kv.get(key, { type: 'text' });
  if (text === null || text === undefined) return null;
  try { return JSON.parse(text); } catch (err) { return null; }
}
export { readJson };
const iso = (t) => new Date(t).toISOString();
const time = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : null; };
const clip = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const str = (v, n = 40) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const signal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The tracking list: the hand-added numbers first, then the export's (newest first), cleaned, without repeats.
export function wantedNumbers(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const list = (v, max) => (Array.isArray(v) ? v : []).map(cleanTrackingNumber).filter(Boolean).slice(0, max);
  return [...new Set([...list(d.manual, MAX_MANUAL), ...list(d.export, MAX_EXPORT)])];
}
// The page sends carrier labels; only the known ones become slugs.
export function slugForCarrier(label) {
  return Object.prototype.hasOwnProperty.call(CARRIER_SLUGS, label) ? CARRIER_SLUGS[label] : '';
}
export function carrierName(slug) {
  const s = String(slug || '').toLowerCase();
  if (!s) return '';
  if (SLUG_NAMES[s]) return SLUG_NAMES[s];
  return s.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').slice(0, 40);
}

// --- Talking to AfterShip -------------------------------------------------------------------------------------
// One request: {ok, status, code, message, data}. A 429 whose window ends within 2 seconds is waited out and sent
// once more. A network failure or timeout comes back as status 0.
async function asRequest(env, fetchImpl, method, path, { query, body } = {}) {
  const url = new URL(AFTERSHIP_BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const send = () => fetchImpl(url.toString(), {
    method,
    headers: { 'as-api-key': String(env.AFTERSHIP_API_KEY).trim(), 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal(),
  });
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { res = await send(); } catch (err) { return { ok: false, status: 0, code: 0, message: 'AfterShip could not be reached.', data: null, calls: attempt + 1 }; }
    if (res.status !== 429 || attempt) break;
    const wait = waitMs(res);
    if (wait === null || wait > 2000) break;
    await sleep(wait);
  }
  let json = null;
  try { json = await res.json(); } catch (err) { json = null; }
  const meta = json && json.meta || {};
  return { ok: res.ok, status: res.status, code: Number(meta.code) || res.status, message: clip(meta.message, 200), data: json && json.data, headers: res.headers };
}
// How long until the rate-limit window ends: Retry-After (seconds) or X-RateLimit-Reset (Unix time).
function waitMs(res, now = Date.now()) {
  const h = (k) => res.headers && typeof res.headers.get === 'function' ? res.headers.get(k) : null;
  const after = Number(h('retry-after'));
  if (Number.isFinite(after) && after >= 0 && h('retry-after') !== null) return after * 1000;
  const reset = Number(h('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - now) + 50;
  return null;
}
// A refused key or the rate limit stops the whole check; other failures only affect their numbers.
function fatal(r) {
  if (r.status === 401 || r.status === 403 || r.code === 401 || r.code === 403) {
    return new AfterShipError('AfterShip refused the API key. Check AFTERSHIP_API_KEY (Worker and Pages secrets).', 502);
  }
  if (r.status === 429 || r.code === 429) {
    return new AfterShipError('AfterShip says too many requests right now. The rest waits for the next check.', 429);
  }
  return null;
}

// --- Reading AfterShip answers ----------------------------------------------------------------------------------
function place(cp) {
  const loc = clip(cp && cp.location, 80);
  if (loc) return loc;
  return [clip(cp && cp.city, 40), clip(cp && cp.state, 20), clip(cp && cp.country_region, 3)].filter(Boolean).join(', ');
}
// One AfterShip tracking -> the page's status record.
export function normalizeTracking(t, number, now = Date.now()) {
  const x = t && typeof t === 'object' ? t : {};
  const tag = TAGS.includes(x.tag) ? x.tag : 'Pending';
  const cps = (Array.isArray(x.checkpoints) ? x.checkpoints : []).filter((c) => c && typeof c === 'object');
  // AfterShip lists checkpoints oldest first; the event time decides when it gives one.
  let last = null;
  let lastT = -Infinity;
  cps.forEach((c, i) => {
    const t2 = time(c.checkpoint_time) ?? time(c.created_at) ?? -Infinity;
    if (t2 > lastT || (t2 === lastT && i > 0)) { last = c; lastT = t2; }
  });
  if (!last && cps.length) last = cps[cps.length - 1];
  const lastEvent = last ? { at: str(last.checkpoint_time) || str(last.created_at), city: place(last), desc: clip(last.message || last.subtag_message || TAG_TEXT[last.tag] || '', 160) } : null;
  const delivered = tag === 'Delivered';
  const deliveredCp = delivered ? [...cps].reverse().find((c) => c.tag === 'Delivered') : null;
  const deliveredAt = delivered ? str(x.shipment_delivery_date) || str(deliveredCp && deliveredCp.checkpoint_time) || (lastEvent && lastEvent.at) || '' : '';
  const est = (o, ...keys) => { for (const k of keys) { const v = o && typeof o === 'object' ? str(o[k]) : ''; if (v) return v; } return ''; };
  const eta = delivered ? '' : est(x.latest_estimated_delivery, 'datetime', 'datetime_max', 'datetime_min')
    || est(x.courier_estimated_delivery_date, 'estimated_delivery_date', 'estimated_delivery_date_max')
    || est(x.aftership_estimated_delivery_date, 'estimated_delivery_date', 'estimated_delivery_date_max')
    || est(x.custom_estimated_delivery_date, 'estimated_delivery_date', 'estimated_delivery_date_max');
  // The carrier's event time, not when AfterShip recorded it (created_at only when the event time cannot be read).
  const changed = time(lastEvent && lastEvent.at) ?? time(last && last.created_at) ?? (delivered ? time(deliveredAt) : null);
  const changedAt = changed === null ? '' : iso(changed);
  const slug = str(x.slug, 60).toLowerCase();
  return {
    number,
    id: str(x.id, 80),
    slug,
    carrier: carrierName(slug),
    tag,
    subtag: str(x.subtag, 40),
    status: TAG_TEXT[tag],
    detail: clip(x.subtag_message, 120),
    state: TAG_STATE[tag],
    stage: TAG_STAGE[tag],
    lastEvent,
    eta,
    deliveredAt,
    shippedAt: str(x.shipment_pickup_date),
    originCountry: str(x.origin_country_region, 3).toUpperCase(),
    destCountry: str(x.destination_country_region, 3).toUpperCase(),
    destCity: clip(x.destination_city, 60),
    destState: clip(x.destination_state, 40),
    destRaw: clip(x.destination_raw_location, 120),
    changedAt,
    updatedAt: str(x.updated_at),
    notFound: false,
    error: '',
    checkedAt: iso(now),
  };
}
// A number AfterShip would not take (bad format, unknown carrier): kept so the page can say so.
function refusedStatus(number, message, now) {
  return {
    number, id: '', slug: '', carrier: '', tag: '', subtag: '', status: 'Not tracked by AfterShip', detail: '', state: '', stage: '',
    lastEvent: null, eta: '', deliveredAt: '', shippedAt: '', originCountry: '', destCountry: '', destCity: '', destState: '', destRaw: '', changedAt: '', updatedAt: '',
    notFound: true, error: clip(message, 160) || 'AfterShip does not recognise this tracking number.', checkedAt: iso(now),
  };
}
// The tracking a create or "already exists" answer carries ({tracking:{...}} in older versions).
const trackingOf = (data) => (data && typeof data === 'object' ? (data.tracking && typeof data.tracking === 'object' ? data.tracking : data) : null);

// Adds one number. Returns {status?, id?, known?, refused?} or throws an AfterShipError (key refused, rate limit).
async function createOne(env, fetchImpl, number, slug, now) {
  let r = await asRequest(env, fetchImpl, 'POST', TRACKINGS_PATH, { body: slug ? { tracking_number: number, slug } : { tracking_number: number } });
  let calls = 1;
  // A slug AfterShip does not take for this number: once more without it, so AfterShip works the carrier out.
  if (!r.ok && slug && [4005, 4010, 4012, 4017].includes(r.code)) {
    r = await asRequest(env, fetchImpl, 'POST', TRACKINGS_PATH, { body: { tracking_number: number } });
    calls++;
    slug = '';
  }
  const f = fatal(r);
  if (f) { f.calls = calls; throw f; }
  if (r.ok) {
    const t = trackingOf(r.data);
    const status = normalizeTracking(t, number, now);
    return { calls, entry: { id: status.id, slug: status.slug || slug, at: iso(now) }, status };
  }
  if (r.code === 4003) {
    const t = trackingOf(r.data);
    return { calls, entry: { id: str(t && t.id, 80), slug: str(t && t.slug, 60) || slug, at: iso(now) }, known: true };
  }
  if ([4005, 4010, 4012, 4017, 4011, 4008, 4007].includes(r.code)) {
    return { calls, entry: { failedAt: iso(now), error: 'AfterShip does not recognise this tracking number.' }, refused: 'AfterShip does not recognise this tracking number.' };
  }
  return { calls, failed: r.status ? `AfterShip could not add it (HTTP ${r.status}${r.message ? `: ${r.message}` : ''}).` : r.message };
}

// Lists the trackings of up to LIST_BATCH numbers, following next_cursor while the call budget allows.
// Returns {trackings, complete, calls} or throws an AfterShipError (key refused, rate limit).
async function listBatch(env, fetchImpl, numbers, budget) {
  const trackings = [];
  let cursor = '';
  let calls = 0;
  while (calls < budget) {
    const r = await asRequest(env, fetchImpl, 'GET', TRACKINGS_PATH, { query: { tracking_numbers: numbers.join(','), limit: PAGE_LIMIT, cursor } });
    calls++;
    const f = fatal(r);
    if (f) { f.calls = calls; throw f; }
    if (!r.ok) return { trackings, complete: false, calls, message: r.status ? `AfterShip list failed (HTTP ${r.status}${r.message ? `: ${r.message}` : ''}).` : r.message };
    const data = r.data && typeof r.data === 'object' ? r.data : {};
    for (const t of Array.isArray(data.trackings) ? data.trackings : []) if (t && typeof t === 'object') trackings.push(t);
    const p = data.pagination || {};
    if (!p.has_next_page || !p.next_cursor || String(p.next_cursor) === cursor) return { trackings, complete: true, calls };
    cursor = String(p.next_cursor);
  }
  return { trackings, complete: false, calls, message: 'More pages than this check could read; the rest comes next time.' };
}

function scrub(message, env) {
  let m = String(message || 'AfterShip tracking failed.');
  const key = String(env && env.AFTERSHIP_API_KEY || '');
  if (key.length >= 4) m = m.split(key).join('***');
  return m.slice(0, 300);
}

// One check. For the wanted numbers that are not delivered yet (stalest first, at most maxPerRun(env), with at most
// maxCalls(env) AfterShip requests): adds the ones AfterShip does not know yet, reads the others in batches, and saves
// the results (tracking:index) and the AfterShip ids (tracking:aftership). Delivered numbers are final and are not
// asked again. When AfterShip refuses the key (or nothing at all could be read), the previous results stay, lastError
// says why and the error is thrown for the caller (the Worker log or "Refresh now"). A rate limit part-way keeps
// what was read and leaves the rest for the next check. If the stored documents cannot be read, nothing is written.
export async function pollTracking(env, opts = {}) {
  const kv = env && env.REPORT_STORE;
  if (!kv) throw new AfterShipError('Shared storage is not set up on this site (REPORT_STORE).', 503);
  if (!aftershipConfigured(env)) throw new AfterShipError('AfterShip tracking is not set up on this site (AFTERSHIP_API_KEY).', 503);
  const fetchImpl = opts.fetch || globalThis.fetch;
  const now = opts.now ?? Date.now();
  const source = opts.source || 'cron';
  let wanted, prev, idsDoc;
  try {
    wanted = await readJsonStrict(kv, WANTED_KEY);
    prev = (await readJsonStrict(kv, INDEX_KEY)) || {};
    idsDoc = (await readJsonStrict(kv, IDS_KEY)) || {};
  } catch (err) {
    throw new AfterShipError('The shared storage (REPORT_STORE) could not be read, so AfterShip was not checked. Try again in a minute.', 503);
  }
  const prevStatuses = prev.statuses && typeof prev.statuses === 'object' ? prev.statuses : {};
  const ids = idsDoc.ids && typeof idsDoc.ids === 'object' ? { ...idsDoc.ids } : {};
  const carriers = wanted && wanted.carriers && typeof wanted.carriers === 'object' ? wanted.carriers : {};
  const numbers = wantedNumbers(wanted);
  const isDelivered = (n) => prevStatuses[n] && (prevStatuses[n].state === 'delivered' || prevStatuses[n].stage === 'delivered');
  const pending = numbers.filter((n) => !isDelivered(n)).slice(0, MAX_TRACKED);
  const lastChecked = (n) => (prevStatuses[n] && time(prevStatuses[n].checkedAt)) ?? -Infinity;
  const stalest = pending.map((n, i) => ({ n, i, t: lastChecked(n) })).sort((a, b) => (a.t === b.t ? a.i - b.i : a.t - b.t)).map((x) => x.n);
  const retryAfter = now - RETRY_FAILED_HOURS * 3600 * 1000;
  // Refused a day ago or less: not offered again yet (its status says why).
  const resting = (n) => ids[n] && !ids[n].id && !ids[n].known && ids[n].failedAt && (time(ids[n].failedAt) ?? 0) > retryAfter;
  const asked = stalest.filter((n) => !resting(n)).slice(0, maxPerRun(env));
  const isKnown = (n) => !!(ids[n] && (ids[n].id || ids[n].known));
  const toCreate = asked.filter((n) => !isKnown(n));
  let toList = asked.filter(isKnown);
  const budget = maxCalls(env);
  // Keep a few requests for reading the known numbers, so a long list of new numbers never stops the updates.
  const reserve = toList.length ? Math.min(Math.ceil(toList.length / LIST_BATCH), Math.max(1, Math.floor(budget / 4))) : 0;
  const createCap = Math.max(0, budget - reserve);

  const results = {};
  const errors = [];
  let calls = 0;
  let created = 0;
  let stopped = null; // an AfterShipError that ended the check early
  let answered = 0;

  for (const n of toCreate) {
    if (calls >= createCap) break;
    let out;
    try { out = await createOne(env, fetchImpl, n, slugForCarrier(carriers[n]) || '', now); } catch (err) {
      calls += err && err.calls || 1;
      stopped = err instanceof AfterShipError ? err : new AfterShipError('AfterShip tracking failed.', 502);
      break;
    }
    calls += out.calls;
    if (out.entry) ids[n] = out.entry;
    if (out.status) { results[n] = out.status; created++; answered++; } else if (out.known) {
      ids[n] = { ...out.entry, known: true };
      answered++;
      toList.push(n); // read with the known ones below, if the budget allows
    } else if (out.refused) { results[n] = refusedStatus(n, out.refused, now); answered++; } else {
      errors.push({ numbers: 1, status: 0, message: out.failed || 'AfterShip could not add it.' });
    }
  }
  let listed = 0;
  if (!stopped) {
    for (let i = 0; i < toList.length; i += LIST_BATCH) {
      if (calls >= budget) break;
      const batch = toList.slice(i, i + LIST_BATCH);
      let out;
      try { out = await listBatch(env, fetchImpl, batch, budget - calls); } catch (err) {
        calls += err && err.calls || 1;
        stopped = err instanceof AfterShipError ? err : new AfterShipError('AfterShip tracking failed.', 502);
        break;
      }
      calls += out.calls;
      if (out.message) errors.push({ numbers: batch.length, status: 0, message: out.message });
      if (!out.trackings.length && !out.complete) continue;
      answered++;
      const byNumber = new Map();
      for (const t of out.trackings) {
        const n = cleanTrackingNumber(t.tracking_number);
        if (!n) continue;
        if (!byNumber.has(n)) byNumber.set(n, []);
        byNumber.get(n).push(t);
      }
      for (const n of batch) {
        const found = byNumber.get(n) || [];
        if (!found.length) {
          // AfterShip no longer has it (deleted there): it is added again at the next check.
          if (out.complete) delete ids[n];
          continue;
        }
        const own = ids[n] && ids[n].id ? found.find((t) => t.id === ids[n].id) : null;
        const pick = own || found.sort((a, b) => (time(b.updated_at) || 0) - (time(a.updated_at) || 0))[0];
        results[n] = normalizeTracking(pick, n, now);
        ids[n] = { id: results[n].id, slug: results[n].slug, at: (ids[n] && ids[n].at) || iso(now) };
        listed++;
      }
    }
  }

  const fail = async (err) => {
    const message = scrub(err && err.message, env);
    await kv.put(INDEX_KEY, JSON.stringify({ ...prev, v: 2, provider: 'aftership', statuses: prevStatuses, lastError: { at: iso(now), message } }));
    throw new AfterShipError(message, err && err.status || 502);
  };
  // Nothing could be done at all: keep the last results, say why.
  if (stopped && !answered) return fail(stopped);
  if (!stopped && asked.length && !answered && errors.length) return fail(new AfterShipError(errors[0].message, 502));

  const statuses = {};
  const keepSince = now - INDEX_KEEP_DAYS * DAY;
  for (const [n, s] of Object.entries(prevStatuses)) {
    if (s && (s.state === 'delivered' || s.stage === 'delivered') && (time(s.deliveredAt) ?? time(s.checkedAt) ?? -Infinity) >= keepSince) statuses[n] = s;
  }
  for (const n of numbers) {
    if (results[n]) statuses[n] = results[n];
    else if (prevStatuses[n]) statuses[n] = prevStatuses[n];
  }
  // The id map keeps what is still wanted, or was added in the last INDEX_KEEP_DAYS.
  const keepIds = {};
  const wantedSet = new Set(numbers);
  for (const [n, e] of Object.entries(ids)) {
    if (!e || typeof e !== 'object') continue;
    if (wantedSet.has(n) || (time(e.at || e.failedAt) ?? 0) >= keepSince) keepIds[n] = e;
  }
  const polled = Object.keys(results).length;
  const doc = {
    v: 2, provider: 'aftership', polledAt: iso(now), source, count: numbers.length, polled, created,
    waiting: Math.max(0, pending.length - polled), calls, statuses,
    errors: errors.slice(0, 20).map((e) => ({ ...e, message: scrub(e.message, env) })),
  };
  if (stopped) doc.lastError = { at: iso(now), message: scrub(stopped.message, env) };
  await kv.put(IDS_KEY, JSON.stringify({ v: 1, ids: keepIds }));
  await kv.put(INDEX_KEY, JSON.stringify(doc));
  return doc;
}
