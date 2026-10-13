/**
 * Names of the people who edit shared notes, kept for everyone who signs in so the "Your name" dialog can offer them
 * as one-click choices. Same Workers KV namespace as the notes (binding REPORT_STORE, key 'people'; see
 * docs/IT_HOSTING_README.md). The password gate in functions/_middleware.js runs first.
 *   GET  /api/people -> {v:1, people:[{name, firstSeen, lastSeen}]}, the most recently seen first
 *   POST /api/people    body {name}
 *        Adds the name, or marks it as seen when it is already saved (in any capitalisation: the first spelling
 *        stays). Returns {saved, name, people}: `name` as stored, `saved` whether Workers KV was written.
 * A name is trimmed and its spaces collapsed, then must be 1 to 40 characters: letters (any language), spaces and
 * . ' - only, with at least one letter. At most 300 names are kept: a new one beyond that replaces the name seen
 * longest ago. Names are not checked against accounts (the site has one shared password).
 * Workers KV is written only when the list changes, or when a name was last seen more than a day ago (the page sends
 * its name at most once a day), so page opens cost no writes. 500 when the stored list cannot be read (nothing is
 * written); 429 with Retry-After when Workers KV is busy (one write per second to the key).
 */
const KEY = 'people';
const MAX_BODY = 2048; // one POST: {"name":"..."} with a 40-character name is far smaller
const MAX_PEOPLE = 300;
const SEEN_EVERY_MS = 24 * 60 * 60 * 1000;
const PUT_RETRY_MS = 1100; // Workers KV: one write per second to the same key
const NAME_MAX = 40;
const NAME_RE = /^[\p{L}\p{M} .'-]+$/u;
const HAS_LETTER_RE = /\p{L}/u;

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.REPORT_STORE;
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'Use GET or POST.' }, { Allow: 'GET, POST' });
  if (!store) return json(503, { configured: false, error: 'Shared storage is not set up on this site (REPORT_STORE).' });

  if (request.method === 'GET') {
    // A failed read, or a value that is not a list of people (edited by hand), shows no names; nothing is changed.
    let people = [];
    try { people = await readPeople(store); } catch (err) { people = []; }
    return json(200, { v: 1, people });
  }

  // The session cookie is SameSite=Lax, and only the dashboard page itself may add a name.
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json(403, { error: 'Cross-site request refused.' });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return tooLarge();
  const text = await request.text();
  if (text.length > MAX_BODY) return tooLarge();
  let body;
  try { body = JSON.parse(text); } catch (err) { return json(400, { error: 'The name is not valid JSON.' }); }
  const name = body && typeof body === 'object' && !Array.isArray(body) ? cleanName(body.name) : '';
  if (!name) return json(400, { error: `A name is 1 to ${NAME_MAX} letters, spaces and . ' - (at least one letter).` });

  // A failed read must never be taken for "no names yet": the new list would replace everyone's.
  let people;
  try { people = await readPeople(store); } catch (err) {
    return json(500, { error: 'The saved names could not be read; your name is kept in this browser, try again later.' });
  }
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const same = name.toLowerCase();
  const found = people.find((p) => p.name.toLowerCase() === same);
  let changed = false;
  if (found) {
    if (now - time(found.lastSeen) > SEEN_EVERY_MS) { found.lastSeen = iso; changed = true; }
  } else {
    people.push({ name, firstSeen: iso, lastSeen: iso });
    changed = true;
  }
  people = order(people).slice(0, MAX_PEOPLE); // full: the name seen longest ago gives way to the new one
  if (changed) {
    const stored = JSON.stringify({ v: 1, people });
    try { await store.put(KEY, stored); } catch (err) {
      // Workers KV takes one write per second to the same key; another save may have just gone in. Try once more.
      await new Promise((r) => setTimeout(r, PUT_RETRY_MS));
      try { await store.put(KEY, stored); } catch (err2) {
        return json(429, { error: 'Busy saving, try again.' }, { 'Retry-After': '2' });
      }
    }
  }
  return json(200, { saved: changed, name: found ? found.name : name, people });
}

// Trimmed, spaces collapsed, curly apostrophes made straight; '' when it is not a name by the rules above.
function cleanName(v) {
  if (typeof v !== 'string' || v.length > NAME_MAX * 4) return '';
  const s = v.normalize('NFC').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= NAME_MAX && NAME_RE.test(s) && HAS_LETTER_RE.test(s) ? s : '';
}

// The stored list, checked entry by entry: bad names and repeats (any capitalisation) are left out. Nothing saved
// yet gives []. A failed read, or a value that is not a people document, throws: it must never be taken for "no
// names yet" by a POST.
async function readPeople(store) {
  const saved = await store.get(KEY, { type: 'json' });
  if (saved === null) return [];
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('The stored value is not a list of people.');
  const list = Array.isArray(saved.people) ? saved.people : [];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const name = cleanName(p.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, firstSeen: isoOr(p.firstSeen), lastSeen: isoOr(p.lastSeen) });
  }
  return order(out).slice(0, MAX_PEOPLE);
}

// The most recently seen first (ties: the earlier first seen, then A to Z), so the page lists them as they are.
function order(people) {
  return people.sort((a, b) => time(b.lastSeen) - time(a.lastSeen) || time(a.firstSeen) - time(b.firstSeen) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function isoOr(v) {
  const t = typeof v === 'string' && v.length <= 40 ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

function time(at) {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
}

function tooLarge() {
  return json(413, { error: 'Too large: send {"name":"..."} only.' });
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
