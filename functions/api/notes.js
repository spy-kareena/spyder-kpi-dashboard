/**
 * Shared notes: the override status, note, Us / Them cause and "deleted" flag people set on order lines, plus
 * tracking numbers typed in by hand for the Shipping page, kept for everyone who signs in. Uses the same Workers KV
 * namespace as the shared report (binding REPORT_STORE, key 'overrides'; see docs/IT_HOSTING_README.md). The
 * password gate in functions/_middleware.js runs first.
 *   GET   /api/notes -> {v:1, rows:{[rowKey]:entry}, shipments:{[id]:entry}, savedAt}
 *   PATCH /api/notes    body {rows?:{[rowKey]:entry}, shipments?:{[id]:entry}}
 *         Each key is merged on its own: the entry with the newer `at` wins, a tie keeps the stored one. Returns
 *         {savedAt, applied, rows, shipments} with the stored entry for every key sent, so the page can take a
 *         newer edit made on another computer.
 * Row entry: {status, notes, cause:'us'|'them'|'', deleted, by, at}. `by` is the editor's initials, `at` the
 * time of the edit (ISO). An entry with no status, note, cause or deleted flag records that the line was cleared;
 * it is kept so other browsers drop their copy, and pruned after 180 days only when storage runs full.
 * Shipment entry: {order, number, carrier?, deleted?, by, at}.
 * One KV read per page open and one KV write per batch of edits (the page waits 800 ms after the last change).
 */
const KEY = 'overrides';
const MAX_BODY = 1024 * 1024; // one PATCH
const MAX_DOC = 5 * 1024 * 1024; // everything stored (a KV value may hold 25 MiB)
const MAX_ENTRIES = 5000; // keys in one PATCH
const MAX_NOTE = 4000;
const PRUNE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
const FUTURE_SLACK_MS = 5 * 60 * 1000;
// Row keys are built from SAP fields joined with "|"; they never hold control characters.
const ROW_KEY_RE = /^[^\u0000-\u001f\u007f]{1,300}$/;
const SHIPMENT_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const TEXT_RE = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const CAUSES = new Set(['us', 'them', '']);

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.REPORT_STORE;
  if (request.method !== 'GET' && request.method !== 'PATCH') return json(405, { error: 'Use GET or PATCH.' }, { Allow: 'GET, PATCH' });
  if (!store) return json(503, { configured: false, error: 'Shared notes storage is not set up on this site (REPORT_STORE).' });

  if (request.method === 'GET') return json(200, await readDoc(store));

  // The session cookie is SameSite=Lax, and only the dashboard page itself may change the notes.
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json(403, { error: 'Cross-site request refused.' });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return tooLarge();
  const text = await request.text();
  if (text.length > MAX_BODY) return tooLarge();
  let body;
  try { body = JSON.parse(text); } catch (err) { return json(400, { error: 'The changes are not valid JSON.' }); }
  const incoming = readChanges(body);
  if (incoming.error) return json(400, { error: incoming.error });

  const now = Date.now();
  const doc = await readDoc(store);
  let applied = 0;
  const out = { rows: {}, shipments: {} };
  for (const kind of ['rows', 'shipments']) {
    for (const [key, entry] of incoming[kind]) {
      if (entry.at > now + FUTURE_SLACK_MS) entry.at = now; // a computer clock set ahead cannot win every merge
      const current = doc[kind][key];
      if (!current || entry.at > time(current.at)) { doc[kind][key] = { ...entry, at: new Date(entry.at).toISOString() }; applied++; }
      out[kind][key] = doc[kind][key];
    }
  }
  const savedAt = new Date(now).toISOString();
  if (applied) {
    doc.savedAt = savedAt;
    if (!fits(doc)) prune(doc, now);
    if (!fits(doc)) return json(413, { error: 'Shared notes storage is full (5 MB). Ask IT to clear old notes.' });
    await store.put(KEY, JSON.stringify(doc));
  }
  return json(200, { savedAt: applied ? savedAt : doc.savedAt || '', applied, ...out });
}

// The stored document, or an empty one (nothing saved yet, or an unreadable value).
async function readDoc(store) {
  let saved = null;
  try { saved = await store.get(KEY, { type: 'json' }); } catch (err) { saved = null; }
  const doc = { v: 1, rows: {}, shipments: {}, savedAt: '' };
  if (!saved || typeof saved !== 'object') return doc;
  for (const kind of ['rows', 'shipments']) {
    const map = saved[kind];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      for (const [k, v] of Object.entries(map)) if (!RESERVED.has(k) && v && typeof v === 'object') doc[kind][k] = v;
    }
  }
  doc.savedAt = typeof saved.savedAt === 'string' ? saved.savedAt : '';
  return doc;
}

// Checks every key and field; returns [[key, cleanEntry], ...] per kind, or {error}.
function readChanges(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send {rows:{...}} and/or {shipments:{...}}.' };
  const out = { rows: [], shipments: [] };
  let count = 0;
  for (const kind of ['rows', 'shipments']) {
    const map = body[kind];
    if (map === undefined) continue;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return { error: `${kind} must be an object of entries.` };
    for (const [key, raw] of Object.entries(map)) {
      if (++count > MAX_ENTRIES) return { error: `At most ${MAX_ENTRIES} changes can be sent at once.` };
      const bad = RESERVED.has(key) || !(kind === 'rows' ? ROW_KEY_RE : SHIPMENT_ID_RE).test(key);
      if (bad) return { error: `Bad ${kind === 'rows' ? 'line' : 'shipment'} key.` };
      const entry = kind === 'rows' ? rowEntry(raw) : shipmentEntry(raw);
      if (entry.error) return entry;
      out[kind].push([key, entry]);
    }
  }
  if (!count) return { error: 'No changes sent.' };
  return out;
}

function stamp(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Each change must be an object.' };
  const at = typeof raw.at === 'string' && raw.at.length <= 40 ? Date.parse(raw.at) : NaN;
  if (!Number.isFinite(at) || at < Date.UTC(2000, 0, 1)) return { error: 'Each change needs the time it was made (at).' };
  const by = raw.by === undefined ? '' : raw.by;
  if (!text(by, 16)) return { error: 'Initials (by) must be text of at most 16 characters.' };
  return { by, at };
}

function rowEntry(raw) {
  const head = stamp(raw);
  if (head.error) return head;
  const entry = {};
  if (raw.status !== undefined) { if (!text(raw.status, 80)) return { error: 'Override status must be text of at most 80 characters.' }; entry.status = raw.status; }
  if (raw.notes !== undefined) { if (!text(raw.notes, MAX_NOTE)) return { error: `A note must be text of at most ${MAX_NOTE.toLocaleString('en-US')} characters.` }; entry.notes = raw.notes; }
  if (raw.cause !== undefined) { if (!CAUSES.has(raw.cause)) return { error: 'Cause must be "us", "them" or blank.' }; entry.cause = raw.cause; }
  if (raw.deleted !== undefined) { if (typeof raw.deleted !== 'boolean') return { error: 'deleted must be true or false.' }; if (raw.deleted) entry.deleted = true; }
  return { ...entry, by: head.by, at: head.at };
}

function shipmentEntry(raw) {
  const head = stamp(raw);
  if (head.error) return head;
  const entry = {};
  if (!text(raw.order ?? '', 40)) return { error: 'Order must be text of at most 40 characters.' };
  if (!text(raw.number ?? '', 60)) return { error: 'Tracking number must be text of at most 60 characters.' };
  entry.order = raw.order ?? '';
  entry.number = raw.number ?? '';
  if (raw.carrier !== undefined) { if (!text(raw.carrier, 40)) return { error: 'Carrier must be text of at most 40 characters.' }; entry.carrier = raw.carrier; }
  if (raw.deleted !== undefined) { if (typeof raw.deleted !== 'boolean') return { error: 'deleted must be true or false.' }; if (raw.deleted) entry.deleted = true; }
  return { ...entry, by: head.by, at: head.at };
}

function text(v, max) {
  return typeof v === 'string' && v.length <= max && TEXT_RE.test(v);
}

function time(at) {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
}

function isCleared(e) {
  return !e.status && !e.notes && !e.cause && !e.deleted;
}

// Storage full: drop cleared-line markers older than 180 days (their lines have long left the report).
function prune(doc, now) {
  for (const [k, e] of Object.entries(doc.rows)) if (isCleared(e) && now - time(e.at) > PRUNE_AFTER_MS) delete doc.rows[k];
}

function fits(doc) {
  return new TextEncoder().encode(JSON.stringify(doc)).length <= MAX_DOC;
}

function tooLarge() {
  return json(413, { error: 'Too many changes at once (over 1 MB).' });
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
