/**
 * Personal settings: how the board looks and opens for one person, saved to their Cloudflare Access sign-in so they
 * follow them to any computer. The rules behind the numbers are team settings (functions/api/team-settings.js).
 * Same Workers KV namespace as the notes (binding REPORT_STORE; see docs/IT_HOSTING_README.md and docs/ACCESS.md).
 * The sign-in gate in functions/_middleware.js runs first.
 *   GET  /api/prefs -> {v:1, prefs:{...}|null, savedAt:'ISO'|''}   (null and '' while nothing is saved yet)
 *   PUT  /api/prefs    body {prefs:{...}} (POST is taken too) -> {v:1, saved:true, prefs, savedAt}
 *        Replaces the whole set: the page always sends all of its personal settings. Only the personal keys below are
 *        kept; team keys and unknown keys are dropped, and a key sent as null is left out (its default). Each value
 *        must be text (up to 200 characters), a number, true / false, or a list of up to 50 texts (up to 200
 *        characters each); the page checks the values themselves. The set as JSON may be up to 16 KB. A set equal to
 *        the one saved is not written again (Workers KV allows 1,000 writes a day on the free plan).
 * Personal keys: theme, background, christmas, linesShown, openingView, poOpeningView, startPage, linesStart,
 * importReport, dataSource, hiddenPages.
 * Only a person Cloudflare Access signed in has personal settings: the shared password and an Access service token get
 * 401 {error:{code:401, message}}, and the page keeps its settings in that browser, as before.
 * KV key: 'prefs:' + the hex SHA-256 of the lower-case email (no address in the key); value {v:1, email, prefs, savedAt}.
 * Errors: 400 (not JSON, not {prefs:{...}}, a bad value, too large), 401 (above), 403 (a write from another site),
 * 405, 429 with Retry-After (Workers KV busy), 500 (the saved settings could not be read), 503 (no REPORT_STORE:
 * {v:1, prefs:null} or {v:1, saved:false} with the error). Never cached (cache-control: no-store).
 */
import { accessPerson } from '../../shared/admins.mjs';

export const PERSONAL_KEYS = ['theme', 'background', 'christmas', 'linesShown', 'openingView', 'poOpeningView', 'startPage', 'linesStart', 'importReport', 'dataSource', 'hiddenPages'];
const KEY_PREFIX = 'prefs:';
const MAX_BODY = 64 * 1024; // one PUT
const MAX_PREFS = 16 * 1024; // the kept settings, as JSON (UTF-8 bytes)
const MAX_TEXT = 200;
const MAX_LIST = 50;
const PUT_RETRY_MS = 1100; // Workers KV: one write per second to the same key
const NEED_ACCESS = 'Personal settings need the company sign-in.';

export async function onRequest(context) {
  const { request, env } = context;
  const write = request.method === 'PUT' || request.method === 'POST';
  if (request.method !== 'GET' && !write) return error(405, 'Use GET or PUT.', {}, { Allow: 'GET, PUT, POST' });
  // The session cookie is SameSite=Lax, and only the dashboard page itself may change the settings.
  if (write && request.headers.get('Origin') !== new URL(request.url).origin) return error(403, 'Cross-site request refused.');
  const person = accessPerson(context);
  if (!person) return error(401, NEED_ACCESS);
  const store = env && env.REPORT_STORE;
  if (!store) {
    return error(503, 'Personal settings storage is not set up on this site (REPORT_STORE).', write ? { saved: false } : { prefs: null });
  }
  const key = await prefsKey(person.email);

  if (!write) {
    let doc;
    try { doc = await readDoc(store, key, person.email); } catch (err) {
      return error(500, 'Your saved settings could not be read; this browser\'s settings are used, try again later.', { prefs: null });
    }
    return json(200, { v: 1, prefs: doc ? doc.prefs : null, savedAt: doc ? doc.savedAt : '' });
  }

  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return tooLarge();
  const text = await request.text();
  if (text.length > MAX_BODY) return tooLarge();
  let body;
  try { body = JSON.parse(text); } catch (err) { return error(400, 'The settings are not valid JSON.', { saved: false }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.prefs || typeof body.prefs !== 'object' || Array.isArray(body.prefs)) {
    return error(400, 'Send {prefs:{...}}.', { saved: false });
  }
  const prefs = cleanPrefs(body.prefs);
  if (prefs.error) return error(400, prefs.error, { saved: false });
  const stored = JSON.stringify(prefs.value);
  if (bytes(stored) > MAX_PREFS) return tooLarge();

  // The same set as saved: nothing to write. A failed read is no reason to stop: the whole set is replaced anyway.
  let saved = null;
  try { saved = await readDoc(store, key, person.email); } catch (err) { saved = null; }
  if (saved && JSON.stringify(saved.prefs) === stored && saved.savedAt) {
    return json(200, { v: 1, saved: true, prefs: saved.prefs, savedAt: saved.savedAt });
  }
  const savedAt = new Date().toISOString();
  const doc = JSON.stringify({ v: 1, email: person.email, prefs: prefs.value, savedAt });
  try { await store.put(key, doc); } catch (err) {
    // Workers KV takes one write per second to the same key; another save may have just gone in. Try once more.
    await new Promise((r) => setTimeout(r, PUT_RETRY_MS));
    try { await store.put(key, doc); } catch (err2) {
      return error(429, 'Busy saving, try again.', { saved: false }, { 'Retry-After': '2' });
    }
  }
  return json(200, { v: 1, saved: true, prefs: prefs.value, savedAt });
}

// 'prefs:' + hex SHA-256 of the lower-case address.
export async function prefsKey(email) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(email).trim().toLowerCase()));
  return KEY_PREFIX + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Only the personal keys, in a fixed order (so equal sets compare equal): {value} or {error} naming the key.
function cleanPrefs(raw) {
  const value = {};
  for (const k of PERSONAL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    const v = raw[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'boolean') value[k] = v;
    else if (typeof v === 'number') { if (!Number.isFinite(v)) return { error: `${k} must be a number.` }; value[k] = v; }
    else if (typeof v === 'string') { if (v.length > MAX_TEXT) return { error: `${k} must be at most ${MAX_TEXT} characters.` }; value[k] = v; }
    else if (Array.isArray(v)) {
      if (v.length > MAX_LIST || !v.every((x) => typeof x === 'string' && x.length <= MAX_TEXT)) {
        return { error: `${k} must be a list of at most ${MAX_LIST} texts of up to ${MAX_TEXT} characters.` };
      }
      value[k] = v.slice();
    } else return { error: `${k} must be text, a number, true / false or a list of texts.` };
  }
  return { value };
}

// The saved document for this address: {prefs, savedAt}, or null when nothing is saved. A value that is not a
// settings document (or belongs to another address) counts as nothing saved; a failed read throws.
async function readDoc(store, key, email) {
  const saved = await store.get(key, { type: 'json' });
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  if (typeof saved.email === 'string' && saved.email.toLowerCase() !== email) return null;
  const prefs = saved.prefs && typeof saved.prefs === 'object' && !Array.isArray(saved.prefs) ? cleanPrefs(saved.prefs) : { value: {} };
  return { prefs: prefs.error ? {} : prefs.value, savedAt: typeof saved.savedAt === 'string' ? saved.savedAt : '' };
}

function bytes(s) {
  return new TextEncoder().encode(s).length;
}

function tooLarge() {
  return error(400, `Too large: personal settings are at most ${MAX_PREFS / 1024} KB.`, { saved: false });
}

function error(status, message, extra = {}, headers = {}) {
  return json(status, { v: 1, ...extra, error: { code: status, message } }, headers);
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
