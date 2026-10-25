/**
 * Shared notes: the override status, note, Us / Them cause and "deleted" flag people set on order lines, plus
 * tracking numbers typed in by hand for the Shipping page, kept for everyone who signs in. Uses the same Workers KV
 * namespace as the shared report (binding REPORT_STORE, key 'overrides'; see docs/IT_HOSTING_README.md). The
 * password gate in functions/_middleware.js runs first.
 *   GET   /api/notes -> {v:1, rows:{[rowKey]:entry}, shipments:{[id]:entry}, savedAt}
 *   PATCH /api/notes    body {rows?:{[rowKey]:entry}, shipments?:{[id]:entry}}
 *         Each key is merged on its own: the entry with the newer `at` wins, a tie keeps the stored one. Returns
 *         {savedAt, applied, rows, shipments} with the stored entry for every key sent, so the page can take a
 *         newer edit made on another computer. At most 500 keys new to the server are taken per PATCH; the rest
 *         are left out of the reply and counted in `skipped`, for the page to send again.
 *         500 when the stored notes cannot be read (nothing is written); 429 with Retry-After when Workers KV is
 *         busy (one write per second to the key), so the page sends the batch again.
 * Row entry: {status, notes, cause:'us'|'them'|'', deleted, by, at}. `by` is the editor's name (the same rules as
 * functions/api/people.js: up to 40 letters, spaces and . ' -; initials saved before 2v2 are still taken), `at` the
 * time of the edit (ISO, never later than the server's clock). An entry with no status, note, cause or deleted flag
 * records that the line was cleared; it is kept for 180 days so other browsers drop their copy (older markers are
 * dropped on every save). When storage runs full (2 MB), the entries edited longest ago go (`pruned` in the reply).
 * Shipment entry: {order, number, carrier?, status?, statusDate?, note?, deleted?, by, at}. A tracking number added by
 * hand is keyed by the number; the manual delivery status someone set on the Shipping page is keyed 'st:<number>'
 * (status 'shipped' | 'transit' | 'delayed' | 'delivered' | '' for none, statusDate YYYY-MM-DD or '', note up to 200
 * characters). Nothing here talks to a carrier: people check the carrier's page and type what they saw.
 * One KV read per page open and one KV write per batch of edits (the page waits 800 ms after the last change to a
 * line, and at least 1.1 s between PATCHes). GET hands back the stored text without parsing it (every entry was
 * checked before it was saved), so a page open costs almost no CPU whatever the size; only a PATCH reads and
 * rewrites the whole document.
 * Workers KV has no locking, and another Cloudflare location can read a copy up to 60 s old, so a PATCH there within
 * a minute of one here can drop this one's lines. The page reads the notes again about a minute after each save that
 * changed something and sends back any line missing on the server (recheckSharedNotes in index.html).
 */
const KEY = 'overrides';
const MAX_BODY = 1024 * 1024; // one PATCH
// Everything stored. A KV value may hold 25 MiB, but each PATCH parses and rewrites the whole document, and its CPU
// time grows with the size (the Workers Free plan allows 10 ms per request).
const MAX_DOC = 2 * 1024 * 1024;
const EMPTY_DOC = '{"v":1,"rows":{},"shipments":{},"savedAt":""}';
const MAX_ENTRIES = 5000; // keys in one PATCH
const MAX_NEW_KEYS = 500; // keys in one PATCH that are not stored yet (the page sends at most 500 per PATCH)
const MAX_NOTE = 4000;
const PRUNE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
const PUT_RETRY_MS = 1100; // Workers KV: one write per second to the same key
// Row keys are built from SAP fields joined with "|"; they never hold control characters.
const ROW_KEY_RE = /^[^\u0000-\u001f\u007f]{1,300}$/;
const SHIPMENT_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const TEXT_RE = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const CAUSES = new Set(['us', 'them', '']);
const SHIP_STATUSES = new Set(['', 'shipped', 'transit', 'delayed', 'delivered']);
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SHIP_NOTE_MAX = 200;
// The editor's name (by): 1 to 40 characters, letters (any language), spaces and . ' - with at least one letter, as in
// functions/api/people.js. Initials saved by pages before 2v2 (letters and digits, up to 16) are still taken.
const NAME_MAX = 40;
const NAME_RE = /^[\p{L}\p{M} .'-]+$/u;
const HAS_LETTER_RE = /\p{L}/u;
const OLD_INITIALS_RE = /^[\p{L}\p{N}]{1,16}$/u;

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.REPORT_STORE;
  if (request.method !== 'GET' && request.method !== 'PATCH') return json(405, { error: 'Use GET or PATCH.' }, { Allow: 'GET, PATCH' });
  if (!store) return json(503, { configured: false, error: 'Shared notes storage is not set up on this site (REPORT_STORE).' });

  if (request.method === 'GET') return raw(await readText(store));

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
  let doc;
  // A failed read must never be taken for "nothing saved": the merged document would replace everyone's notes.
  // (Not 503: the page reads 503 as "no shared storage on this site" and stops sharing.)
  try { doc = await readDoc(store); } catch (err) {
    return json(500, { error: 'Shared notes storage could not be read; your changes are kept in this browser, try again.' });
  }
  let applied = 0;
  let added = 0;
  let skipped = 0;
  const out = { rows: {}, shipments: {} };
  const sent = new Set(); // kept when storage is full and old entries make room
  for (const kind of ['rows', 'shipments']) {
    for (const [key, entry] of incoming[kind]) {
      // Stamped no later than now: a computer clock set ahead (or a made-up time) cannot win later merges.
      if (entry.at > now) entry.at = now;
      const current = Object.prototype.hasOwnProperty.call(doc[kind], key) ? doc[kind][key] : null;
      // Lines new to the server are capped per request (edits to stored lines are not), so one request cannot
      // fill the storage with made-up keys. The page sends at most this many per request.
      if (!current && ++added > MAX_NEW_KEYS) { skipped++; continue; }
      if (!current || entry.at > time(current.at)) { doc[kind][key] = { ...entry, at: new Date(entry.at).toISOString() }; applied++; }
      out[kind][key] = doc[kind][key];
      sent.add(`${kind}|${key}`);
    }
  }
  const savedAt = new Date(now).toISOString();
  let pruned = 0;
  if (applied) {
    doc.savedAt = savedAt;
    pruned = dropOldMarkers(doc, now);
    let stored = JSON.stringify(doc);
    if (!fits(stored)) { pruned += prune(doc, sent); stored = JSON.stringify(doc); }
    if (!fits(stored)) return json(413, { error: 'Shared notes storage is full (2 MB). Ask IT to clear old notes.' });
    try { await store.put(KEY, stored); } catch (err) {
      // Workers KV takes one write per second to the same key; another save may have just gone in. Try once more.
      await new Promise((r) => setTimeout(r, PUT_RETRY_MS));
      try { await store.put(KEY, stored); } catch (err2) {
        return json(429, { error: 'Busy saving, retrying.' }, { 'Retry-After': '2' });
      }
    }
  }
  return json(200, { savedAt: applied ? savedAt : doc.savedAt || '', applied, ...(skipped ? { skipped } : {}), ...(pruned ? { pruned } : {}), ...out });
}

// For the page (GET): the stored text as it is. Every PATCH writes JSON.stringify of a document that starts with
// {"v":1,"rows":{ and checked each entry first, so the text is not parsed here. Nothing saved yet, a failed read or a
// value that is not such a document (edited by hand) gives the empty document.
async function readText(store) {
  let text = null;
  try { text = await store.get(KEY); } catch (err) { text = null; }
  return typeof text === 'string' && text.startsWith('{"v":1,"rows":{') && text.endsWith('}') ? text : EMPTY_DOC;
}

// The stored document before a write, or an empty one when nothing is saved yet. A failed read or an unreadable
// value throws: it must never be taken for "nothing saved".
async function readDoc(store) {
  const saved = await store.get(KEY, { type: 'json' });
  const doc = { v: 1, rows: {}, shipments: {}, savedAt: '' };
  if (saved !== null && (typeof saved !== 'object' || Array.isArray(saved))) throw new Error('The stored notes are not a notes document.');
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
  const by = raw.by === undefined ? '' : editorName(raw.by);
  if (by === null) return { error: `The editor's name (by) must be up to ${NAME_MAX} letters, spaces and . ' - only.` };
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
  if (raw.status !== undefined) { if (!SHIP_STATUSES.has(raw.status)) return { error: 'Shipment status must be shipped, transit, delayed, delivered or blank.' }; entry.status = raw.status; }
  if (raw.statusDate !== undefined) { if (raw.statusDate !== '' && !(typeof raw.statusDate === 'string' && DATE_RE.test(raw.statusDate))) return { error: 'Status date must be YYYY-MM-DD or blank.' }; entry.statusDate = raw.statusDate; }
  if (raw.note !== undefined) { if (!text(raw.note, SHIP_NOTE_MAX)) return { error: `A shipment note must be text of at most ${SHIP_NOTE_MAX} characters.` }; entry.note = raw.note; }
  if (raw.deleted !== undefined) { if (typeof raw.deleted !== 'boolean') return { error: 'deleted must be true or false.' }; if (raw.deleted) entry.deleted = true; }
  return { ...entry, by: head.by, at: head.at };
}

// The name as stored (trimmed, spaces collapsed, curly apostrophes made straight), '' for none, null when refused.
function editorName(v) {
  if (typeof v !== 'string' || v.length > NAME_MAX * 4) return null;
  if (OLD_INITIALS_RE.test(v)) return v;
  const s = v.normalize('NFC').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length <= NAME_MAX && NAME_RE.test(s) && HAS_LETTER_RE.test(s) ? s : null;
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

// On every save: cleared-line markers older than 180 days go (their lines have long left the report, and browsers
// drop their copy as soon as they see the marker), so they never pile up. Returns how many were dropped.
function dropOldMarkers(doc, now) {
  let dropped = 0;
  for (const [k, e] of Object.entries(doc.rows)) if (isCleared(e) && now - time(e.at) > PRUNE_AFTER_MS) { delete doc.rows[k]; dropped++; }
  return dropped;
}

// Storage full: drop the entries edited longest ago (notes, cleared markers and hand-added numbers alike), never
// the ones this request sent, until the document fits again: old notes give way rather than every new edit
// being refused. A browser that still has a dropped note sends it back the next time it opens.
// Returns how many entries were dropped.
function prune(doc, keep = new Set()) {
  let dropped = 0;
  const bytes = (s) => new TextEncoder().encode(s).length;
  const old = [];
  for (const kind of ['rows', 'shipments']) {
    for (const [k, e] of Object.entries(doc[kind])) {
      if (keep.has(`${kind}|${k}`)) continue;
      old.push({ kind, k, e, at: time(e.at) });
    }
  }
  old.sort((a, b) => a.at - b.at);
  // Each entry takes "key":{...}, in the stored JSON.
  let over = bytes(JSON.stringify(doc)) - MAX_DOC;
  for (const o of old) {
    if (over <= 0) break;
    delete doc[o.kind][o.k];
    over -= bytes(JSON.stringify(o.k)) + bytes(JSON.stringify(o.e)) + 2;
    dropped++;
  }
  return dropped;
}

// UTF-8 needs at most 3 bytes per UTF-16 unit, so short documents are measured without encoding them.
function fits(text) {
  return text.length * 3 <= MAX_DOC || new TextEncoder().encode(text).length <= MAX_DOC;
}

function tooLarge() {
  return json(413, { error: 'Too many changes at once (over 1 MB).' });
}

function json(status, data, extra = {}) {
  return raw(JSON.stringify(data), status, extra);
}

function raw(text, status = 200, extra = {}) {
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
