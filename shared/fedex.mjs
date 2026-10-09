/**
 * FedEx tracking for the Shipping page. One copy of this code is used by both:
 *   - the Pages Function functions/api/shipping.js ("Refresh now" on the page), and
 *   - the scheduled Worker workers/shipping-poller (checks every 4 hours).
 * No dependencies; runs on Cloudflare Workers and Node.js 20+. See docs/SHIPPING.md.
 *
 * FedEx APIs (a project at developer.fedex.com with the Track API added):
 *   POST {base}/oauth/token                client-credentials sign-in; the token is cached in KV until it expires
 *   POST {base}/track/v1/trackingnumbers   up to 30 tracking numbers per call, with detailed scans
 * {base} is https://apis.fedex.com, or FEDEX_API_BASE (https://apis-sandbox.fedex.com for test keys).
 * Secrets: FEDEX_CLIENT_ID (the project's API key) and FEDEX_CLIENT_SECRET (its secret key). They are only ever
 * sent to FedEx, and neither they nor the FedEx token are ever returned to the page.
 *
 * Workers KV keys (the namespace bound as REPORT_STORE, next to the shared report):
 *   tracking:wanted   {v, updatedAt, exportAsOf, export:[numbers], manual:[numbers]}  what to track (sent by the page)
 *   tracking:index    {v, polledAt, source, count, polled, waiting, statuses:{[number]: status}, errors, lastError}
 *   tracking:token    {token, expiresAt, base, key}  the FedEx sign-in token (expires on its own)
 *   tracking:refresh  time of the last "Refresh now" (expires after 10 minutes, or 1 minute after a failed one;
 *                     the rate limit)
 * Each check asks FedEx about at most MAX_PER_RUN numbers (stalest first), so it fits the Workers Free plan's
 * 10 ms of CPU per run; a longer list is worked through over several checks.
 *
 * A status (one per tracking number, see normalizeTrackResult):
 *   {number, carrier:'FedEx'|'FedEx Freight', service, status, code,
 *    stage: 'label'|'pickedUp'|'inTransit'|'customs'|'outForDelivery'|'delivered'|'exception',
 *    reached (the last normal stage reached, for the progress strip when stage is 'exception'),
 *    lastEvent:{at, city, desc}|null, eta, deliveredAt, shippedAt, customs:[{at, desc, code}],
 *    customsState:''|'clearance'|'delay'|'released', customsStart, customsEnd,
 *    exception:{code, desc, action}|null, originCountry, destCountry, notFound, checkedAt}
 */

export const FEDEX_BASE = 'https://apis.fedex.com';
export const TRACK_BATCH = 30; // the Track API takes at most 30 numbers per request
export const WANTED_KEY = 'tracking:wanted';
export const INDEX_KEY = 'tracking:index';
export const TOKEN_KEY = 'tracking:token';
export const REFRESH_KEY = 'tracking:refresh';
export const REFRESH_SECONDS = 10 * 60; // "Refresh now" at most once per 10 minutes
export const MAX_EXPORT = 500; // numbers from the export, newest first
export const MAX_MANUAL = 200; // numbers added by hand
// Numbers still moving that are tracked (hand-added first, then the export's). Delivered numbers are never asked
// again, so they do not count: a list of 700 with many delivered still gets every hand-added number checked.
export const MAX_TRACKED = 600;
// Numbers asked per check, stalest first (never checked, then the oldest checkedAt): 2 FedEx calls. Parsing FedEx's
// detailed answers costs about 1 ms of CPU per 10 numbers, and the Workers Free plan allows 10 ms per run, so a
// long list is worked through over several checks. On Workers Paid (30 s of CPU) set FEDEX_MAX_PER_RUN, up to 600.
export const MAX_PER_RUN = 60;
// Delivered statuses stay this long after delivery, even when no longer tracked: the page stops tracking a delivery
// 7 days after FedEx delivered it but still lists it while it shipped within 30 days of the export (SHIP_WINDOW_DAYS
// in index.html), so a shorter time would show those rows as "Not checked yet".
export const INDEX_KEEP_DAYS = 45;
export const STAGES = ['label', 'pickedUp', 'inTransit', 'customs', 'outForDelivery', 'delivered'];
export const STAGE_LABELS = {
  label: 'Label created', pickedUp: 'Picked up', inTransit: 'In transit', customs: 'In customs',
  outForDelivery: 'Out for delivery', delivered: 'Delivered', exception: 'Exception',
};
const DAY = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 20000;

export class FedexError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'FedexError'; this.status = status; }
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

export function fedexConfigured(env) {
  return !!(env && String(env.FEDEX_CLIENT_ID || '').trim() && String(env.FEDEX_CLIENT_SECRET || '').trim());
}
// Only an https URL is accepted, so the keys can never be sent in clear text.
export function fedexBase(env) {
  const raw = String(env && env.FEDEX_API_BASE || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(raw) ? raw : FEDEX_BASE;
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
const iso = (t) => new Date(t).toISOString();
const signal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined);
// Fingerprint of the API key, so a changed key never reuses the old key's token. Not a secret, not reversible.
function keyPrint(env) {
  let h = 2166136261;
  for (const ch of String(env.FEDEX_CLIENT_ID || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
async function fedexMessage(res) {
  try {
    const body = await res.json();
    const e = body && Array.isArray(body.errors) && body.errors[0];
    return e && e.message ? String(e.message).slice(0, 200) : '';
  } catch (err) { return ''; }
}

// OAuth client credentials. The token (about an hour) is kept in KV so checks reuse it until a minute before it ends.
export async function getFedexToken(env, { fetch: fetchImpl = globalThis.fetch, now = Date.now(), force = false } = {}) {
  if (!fedexConfigured(env)) throw new FedexError('FedEx tracking is not set up on this site (FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET).', 503);
  const kv = env.REPORT_STORE;
  const base = fedexBase(env);
  const key = keyPrint(env);
  if (!force && kv) {
    const cached = await readJson(kv, TOKEN_KEY);
    if (cached && cached.token && cached.base === base && cached.key === key && Number(cached.expiresAt) - 60000 > now) return cached.token;
  }
  const res = await fetchImpl(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: String(env.FEDEX_CLIENT_ID).trim(), client_secret: String(env.FEDEX_CLIENT_SECRET).trim() }).toString(),
    signal: signal(),
  });
  if (!res.ok) {
    const refused = [400, 401, 403].includes(res.status);
    throw new FedexError(refused ? 'FedEx refused the API key and secret (check FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET, and FEDEX_API_BASE for sandbox keys).' : `FedEx sign-in failed (HTTP ${res.status}).`, 502);
  }
  const data = await res.json().catch(() => ({}));
  const token = String(data && data.access_token || '');
  if (!token) throw new FedexError('FedEx sign-in gave no token.', 502);
  const seconds = Math.max(60, Number(data.expires_in) || 3600);
  if (kv) await kv.put(TOKEN_KEY, JSON.stringify({ token, expiresAt: now + seconds * 1000, base, key }), { expirationTtl: Math.max(60, Math.floor(seconds - 60)) });
  return token;
}

// Tracks any number of tracking numbers, 30 per FedEx call. A refused token is replaced once and the call retried.
// Returns {statuses:{[number]: status}, errors:[{numbers, status, message}]}; a failed batch does not stop the others.
// When FedEx cannot be used at all (sign-in refused), it throws if nothing came back yet; after a batch has come
// back it stops there and returns what it has, with an error entry for the numbers left.
export async function trackNumbers(numbers, env, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const now = opts.now ?? Date.now();
  const list = [...new Set((numbers || []).map(cleanTrackingNumber).filter(Boolean))];
  const statuses = {};
  const errors = [];
  if (!list.length) return { statuses, errors };
  const base = fedexBase(env);
  let token = await getFedexToken(env, { ...opts, fetch: fetchImpl, now });
  const call = (batch) => fetchImpl(`${base}/track/v1/trackingnumbers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', 'x-locale': 'en_US' },
    body: JSON.stringify({ includeDetailedScans: true, trackingInfo: batch.map((n) => ({ trackingNumberInfo: { trackingNumber: n } })) }),
    signal: signal(),
  });
  let answered = 0;
  for (let i = 0; i < list.length; i += TRACK_BATCH) {
    const batch = list.slice(i, i + TRACK_BATCH);
    let res;
    try {
      res = await call(batch);
      if (res.status === 401) {
        token = await getFedexToken(env, { ...opts, fetch: fetchImpl, now, force: true });
        res = await call(batch);
      }
    } catch (err) {
      if (err instanceof FedexError) {
        if (!answered) throw err;
        errors.push({ numbers: list.length - i, status: err.status || 502, message: err.message });
        break;
      }
      errors.push({ numbers: batch.length, status: 0, message: 'FedEx could not be reached.' });
      continue;
    }
    if (!res.ok) {
      const why = await fedexMessage(res);
      errors.push({ numbers: batch.length, status: res.status, message: `FedEx tracking failed (HTTP ${res.status})${why ? `: ${why}` : '.'}` });
      continue;
    }
    const data = await res.json().catch(() => null);
    const out = normalizeTrackResponse(data, now);
    answered++;
    for (const n of batch) if (out.statuses[n]) statuses[n] = out.statuses[n];
  }
  return { statuses, errors };
}

// --- Normalizing FedEx answers ---------------------------------------------------------------------------------
// FedEx status / scan event codes, by the stage of the progress strip they belong to.
const CODE_STAGE = {
  OC: 'label', IN: 'label', AP: 'label', DS: 'label', EP: 'label', SP: 'label',
  PU: 'pickedUp', PX: 'pickedUp',
  IT: 'inTransit', IX: 'inTransit', AR: 'inTransit', DP: 'inTransit', AF: 'inTransit', FD: 'inTransit', OF: 'inTransit',
  LO: 'inTransit', PF: 'inTransit', PL: 'inTransit', SF: 'inTransit', TR: 'inTransit', AA: 'inTransit', AC: 'inTransit',
  AX: 'inTransit', OX: 'inTransit', CH: 'inTransit', PM: 'inTransit', EO: 'inTransit', EA: 'inTransit', CC: 'inTransit',
  CP: 'customs', CD: 'customs',
  OD: 'outForDelivery', ED: 'outForDelivery', AD: 'outForDelivery',
  DL: 'delivered',
  DE: 'exception', SE: 'exception', CA: 'exception', RS: 'exception', HL: 'exception', DY: 'exception', DD: 'exception', PD: 'exception',
};
const CUSTOMS_TEXT = /customs|clearance|broker|shipment release|\bimport\b|\bexport\b/i;
function stageFromText(text) {
  const s = String(text || '');
  if (!s.trim()) return '';
  if (/clearance delay|customs delay/i.test(s)) return 'customs';
  if (/exception|delay|cancel|return(ed)? to shipper|refused|damaged|unable to deliver|hold at|held at/i.test(s)) return 'exception';
  if (/released|cleared/i.test(s)) return 'inTransit';
  if (CUSTOMS_TEXT.test(s)) return 'customs';
  if (/out for delivery|on fedex vehicle for delivery/i.test(s)) return 'outForDelivery';
  if (/\bdelivered\b/i.test(s)) return 'delivered';
  if (/picked up/i.test(s)) return 'pickedUp';
  if (/label created|shipment information sent|initiated|order created/i.test(s)) return 'label';
  return 'inTransit';
}
const stageOf = (code, derived, text) => CODE_STAGE[code] || CODE_STAGE[derived] || stageFromText(text);
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
function place(loc) {
  const a = loc && (loc.address || loc.locationContactAndAddress && loc.locationContactAndAddress.address || loc) || {};
  return [titleCase(a.city), String(a.stateOrProvinceCode || '').toUpperCase(), String(a.countryCode || '').toUpperCase()].filter(Boolean).join(', ');
}
const country = (...locs) => {
  for (const l of locs) {
    const a = l && (l.address || l.locationContactAndAddress && l.locationContactAndAddress.address || l);
    const c = a && String(a.countryCode || '').trim().toUpperCase();
    if (c) return c;
  }
  return '';
};
const time = (v) => { const t = Date.parse(v || ''); return isFinite(t) ? t : null; };
const clip = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// The Track API answer -> {statuses:{[number]: status}}. A number FedEx does not know yet becomes notFound.
export function normalizeTrackResponse(data, now = Date.now()) {
  const statuses = {};
  const list = data && data.output && Array.isArray(data.output.completeTrackResults) ? data.output.completeTrackResults : [];
  for (const c of list) {
    const number = cleanTrackingNumber(c && c.trackingNumber);
    if (!number) continue;
    const results = Array.isArray(c.trackResults) ? c.trackResults.filter(Boolean) : [];
    // A reused number can return several shipments: take the most recent one FedEx answered without an error.
    const ok = results.filter((r) => !r.error || r.latestStatusDetail);
    const newest = (r) => Math.max(0, ...(r.scanEvents || []).map((e) => time(e && e.date) || 0), ...(r.dateAndTimes || []).map((d) => time(d && d.dateTime) || 0));
    const pick = ok.sort((a, b) => newest(b) - newest(a))[0] || results[0];
    statuses[number] = normalizeTrackResult(pick, number, now);
  }
  return { statuses };
}

export function normalizeTrackResult(r, number, now = Date.now()) {
  const base = {
    number, carrier: 'FedEx', service: '', status: '', code: '', stage: 'label', reached: 'label', lastEvent: null, eta: '', deliveredAt: '',
    shippedAt: '', customs: [], customsState: '', customsStart: '', customsEnd: '', exception: null, originCountry: '', destCountry: '',
    notFound: false, checkedAt: iso(now),
  };
  if (!r || (r.error && !r.latestStatusDetail)) return { ...base, status: 'Not found at FedEx yet', notFound: true };
  const latest = r.latestStatusDetail || {};
  const code = String(latest.code || '').toUpperCase();
  const derived = String(latest.derivedCode || '').toUpperCase();
  const latestText = [latest.statusByLocale, latest.description].filter(Boolean).join(' ');
  const svc = r.serviceDetail || {};
  const carrierCode = String(r.trackingNumberInfo && r.trackingNumberInfo.carrierCode || '').toUpperCase();
  const freight = carrierCode === 'FXFR' || /^(FEDEX_FREIGHT|FXF)/i.test(String(svc.type || '')) || /^fedex freight\b/i.test(String(svc.description || ''));
  const dt = (type) => { const x = (r.dateAndTimes || []).find((d) => d && d.type === type); return x && x.dateTime || ''; };

  // Scan events, newest first.
  const events = (Array.isArray(r.scanEvents) ? r.scanEvents : []).filter(Boolean).map((e) => ({
    at: String(e.date || ''), t: time(e.date), code: String(e.eventType || '').toUpperCase(), derived: String(e.derivedStatusCode || '').toUpperCase(),
    desc: clip(e.eventDescription || e.derivedStatus), extra: clip(e.exceptionDescription), city: place(e.scanLocation),
  })).sort((a, b) => (b.t || 0) - (a.t || 0));

  let stage = CODE_STAGE[code] || CODE_STAGE[derived] || stageFromText(latestText) || (events.length ? 'inTransit' : 'label');
  const delayText = JSON.stringify(latest.delayDetail || {}) + ' ' + JSON.stringify(latest.ancillaryDetails || []);
  const customsDelay = stage !== 'delivered' && (code === 'CD' || (/DELAY/i.test(delayText) && /CUSTOMS|CLEARANCE/i.test(delayText)));
  if (customsDelay) stage = 'customs';

  // How far it got: the furthest normal stage of the latest status and every scan.
  let reachedIdx = STAGES.indexOf(stage);
  for (const e of events) {
    const s = stageOf(e.code, e.derived, `${e.desc} ${e.extra}`);
    const i = STAGES.indexOf(s);
    if (i > reachedIdx) reachedIdx = i;
  }
  if (reachedIdx < 0) reachedIdx = 0;
  if (stage === 'delivered') reachedIdx = STAGES.length - 1;

  // Customs: scans that mention customs, clearance or a broker, oldest first.
  const isCustoms = (e) => e.code === 'CC' || e.code === 'CD' || e.code === 'CP' || CUSTOMS_TEXT.test(`${e.desc} ${e.extra}`);
  const isRelease = (e) => e.code === 'CC' || /released|cleared|shipment release/i.test(e.desc);
  const isDelay = (e) => e.code === 'CD' || /delay/i.test(`${e.desc} ${e.extra}`);
  const chron = events.filter(isCustoms).reverse();
  let customsState = '';
  if (chron.length || stage === 'customs') {
    const last = chron[chron.length - 1];
    const newestIsCustoms = events.length && last && events[0] === last;
    if (stage === 'customs') customsState = customsDelay || (last && isDelay(last)) ? 'delay' : 'clearance';
    else if (stage === 'delivered' || reachedIdx > STAGES.indexOf('customs') || (last && isRelease(last))) customsState = 'released';
    else if (last && isDelay(last)) customsState = 'delay';
    else customsState = newestIsCustoms ? 'clearance' : 'released';
  }
  // A shipment that has been through customs has at least reached that step of the strip.
  if (customsState && reachedIdx < STAGES.indexOf('customs')) reachedIdx = STAGES.indexOf('customs');
  const customsStart = chron.length ? chron[0].at : '';
  let customsEnd = '';
  if (customsState === 'released') {
    const release = chron.find(isRelease);
    const lastCustoms = chron[chron.length - 1];
    // events are newest first, so the last match is the first scan after customs
    const movedOn = lastCustoms && lastCustoms.t !== null ? events.filter((e) => e.t !== null && e.t > lastCustoms.t && !isCustoms(e)).pop() : null;
    customsEnd = release ? release.at : (movedOn && movedOn.at) || '';
  }

  const ancillary = (latest.ancillaryDetails || [])[0] || {};
  const exception = stage === 'exception' || customsState === 'delay'
    ? { code: code || derived, desc: clip(ancillary.reasonDescription || latest.description || latest.statusByLocale || (events[0] && (events[0].extra || events[0].desc))), action: clip(ancillary.actionDescription) }
    : null;
  const newest = events[0];
  const lastEvent = newest
    ? { at: newest.at, city: newest.city, desc: newest.extra ? `${newest.desc} (${newest.extra})` : newest.desc }
    : (latestText ? { at: '', city: place(latest.scanLocation), desc: clip(latest.description || latest.statusByLocale) } : null);
  const windowEnd = (w) => w && w.window && (w.window.ends || w.window.begins) || '';
  const deliveredEvent = events.find((e) => e.code === 'DL' || e.derived === 'DL');
  return {
    ...base,
    carrier: freight ? 'FedEx Freight' : 'FedEx',
    service: clip(svc.description || svc.type, 80),
    status: clip(latest.statusByLocale || latest.description || STAGE_LABELS[stage], 120),
    code: code || derived,
    stage,
    reached: STAGES[reachedIdx],
    lastEvent,
    eta: dt('ESTIMATED_DELIVERY') || windowEnd(r.estimatedDeliveryTimeWindow) || windowEnd(r.standardTransitTimeWindow) || dt('COMMITMENT') || '',
    deliveredAt: stage === 'delivered' ? dt('ACTUAL_DELIVERY') || (deliveredEvent && deliveredEvent.at) || (newest && newest.at) || '' : '',
    shippedAt: dt('SHIP') || dt('ACTUAL_PICKUP') || dt('ACTUAL_TENDER') || '',
    customs: chron.slice(-12).map((e) => ({ at: e.at, desc: e.extra ? `${e.desc} (${e.extra})` : e.desc, code: e.code })),
    customsState,
    customsStart,
    customsEnd,
    exception,
    originCountry: country(r.shipperInformation, r.originLocation),
    destCountry: country(r.recipientInformation, r.destinationLocation, r.lastUpdatedDestinationAddress),
  };
}

// --- The tracking set and the stored results -------------------------------------------------------------------
// The tracking list: the hand-added numbers first, then the export's (newest first), cleaned, without repeats (at
// most MAX_MANUAL + MAX_EXPORT). pollTracking applies MAX_TRACKED to the ones still moving, so delivered numbers
// (never asked again) do not use up the cap and hand-added numbers are never crowded out by the export.
export function wantedNumbers(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const list = (v, max) => (Array.isArray(v) ? v : []).map(cleanTrackingNumber).filter(Boolean).slice(0, max);
  return [...new Set([...list(d.manual, MAX_MANUAL), ...list(d.export, MAX_EXPORT)])];
}

function scrub(message, env) {
  let m = String(message || 'FedEx tracking failed.');
  for (const s of [env.FEDEX_CLIENT_SECRET, env.FEDEX_CLIENT_ID]) if (s && String(s).length >= 4) m = m.split(String(s)).join('***');
  return m.slice(0, 300);
}

// Numbers one check asks FedEx about: MAX_PER_RUN, or FEDEX_MAX_PER_RUN (1 to MAX_TRACKED) where the Worker has
// more CPU time (Workers Paid).
export function maxPerRun(env) {
  const n = Math.floor(Number(env && env.FEDEX_MAX_PER_RUN));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_TRACKED) : MAX_PER_RUN;
}

// One check: asks FedEx about up to maxPerRun(env) wanted numbers that are not delivered yet (the first MAX_TRACKED
// of them, hand-added first), stalest first (never checked, then the oldest check), and saves the results
// (tracking:index). The other numbers keep their last status and come up in the next checks. Delivered numbers are
// final, so they are not asked again (and do not count toward MAX_TRACKED). When FedEx cannot be used at all, the
// previous results stay and lastError says why; the error is thrown for the caller (the Refresh button or the Worker
// log). If the stored list or results cannot be read, nothing is written.
export async function pollTracking(env, opts = {}) {
  const kv = env && env.REPORT_STORE;
  if (!kv) throw new FedexError('Shared storage is not set up on this site (REPORT_STORE).', 503);
  if (!fedexConfigured(env)) throw new FedexError('FedEx tracking is not set up on this site (FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET).', 503);
  const now = opts.now ?? Date.now();
  const source = opts.source || 'cron';
  let wanted, prev;
  try {
    wanted = await readJsonStrict(kv, WANTED_KEY);
    prev = (await readJsonStrict(kv, INDEX_KEY)) || {};
  } catch (err) {
    throw new FedexError('The shared storage (REPORT_STORE) could not be read, so FedEx was not checked. Try again in a minute.', 503);
  }
  const prevStatuses = prev.statuses && typeof prev.statuses === 'object' ? prev.statuses : {};
  const numbers = wantedNumbers(wanted);
  // Still moving: the numbers FedEx is asked about over the checks, capped here (not on the whole list).
  const pending = numbers.filter((n) => !(prevStatuses[n] && prevStatuses[n].stage === 'delivered')).slice(0, MAX_TRACKED);
  const lastChecked = (n) => (prevStatuses[n] && time(prevStatuses[n].checkedAt)) ?? -Infinity;
  const toPoll = pending.map((n, i) => ({ n, i, t: lastChecked(n) }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : a.t - b.t))
    .slice(0, maxPerRun(env)).map((x) => x.n);
  const fail = async (err) => {
    const message = scrub(err && err.message, env);
    await kv.put(INDEX_KEY, JSON.stringify({ ...prev, v: 1, statuses: prevStatuses, lastError: { at: iso(now), message } }));
    throw err instanceof FedexError ? new FedexError(message, err.status) : new FedexError(message, 502);
  };
  let result = { statuses: {}, errors: [] };
  if (toPoll.length) {
    try { result = await trackNumbers(toPoll, env, { ...opts, now }); } catch (err) { return fail(err); }
    if (!Object.keys(result.statuses).length && result.errors.length) return fail(new FedexError(result.errors[0].message, 502));
  }
  const statuses = {};
  const keepSince = now - INDEX_KEEP_DAYS * DAY;
  for (const [n, s] of Object.entries(prevStatuses)) {
    if (s && s.stage === 'delivered' && (time(s.deliveredAt) ?? -Infinity) >= keepSince) statuses[n] = s;
  }
  for (const n of numbers) {
    if (result.statuses[n]) statuses[n] = result.statuses[n];
    else if (prevStatuses[n]) statuses[n] = prevStatuses[n];
  }
  // polled: asked FedEx in this check; waiting: still moving, left for the next checks (stalest first).
  const doc = {
    v: 1, polledAt: iso(now), source, count: numbers.length, polled: toPoll.length, waiting: pending.length - toPoll.length, statuses,
    errors: result.errors.slice(0, 20).map((e) => ({ ...e, message: scrub(e.message, env) })),
  };
  await kv.put(INDEX_KEY, JSON.stringify(doc));
  return doc;
}
