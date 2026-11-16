/**
 * Team settings: the rules behind the numbers, one copy for everyone (the at-risk target, the on-track tolerance, the
 * look-ahead window, the on-time goals for sales orders and vendors, and the ready-made note comments for sales-order and
 * purchase-order lines). Only admins may change them: the Cloudflare Access addresses in the ADMIN_EMAILS secret
 * (shared/admins.mjs). How the board looks and opens is personal instead (functions/api/prefs.js).
 * Same Workers KV namespace as the notes (binding REPORT_STORE, key 'team-settings'; see docs/IT_HOSTING_README.md
 * and docs/ACCESS.md). The sign-in gate in functions/_middleware.js runs first.
 *   GET /api/team-settings -> {v:1, enabled:true, settings:{...}|null, savedAt, savedBy, canEdit, history:[{at, by, keys}]}
 *       enabled   Cloudflare Access is on and ADMIN_EMAILS names at least one admin. When it is not:
 *                 {v:1, enabled:false, settings:null, canEdit:false}, and the board keeps these settings in each
 *                 browser, as before.
 *       settings  the team keys an admin has set (null: every one at its default)
 *       savedBy   the name of the admin who saved last; history: the last 20 saves, newest first, with the keys each
 *                 one changed (['reset'] for a reset)
 *       canEdit   the requester is an admin
 *       Anyone signed in may read (an Access person, an Access service token or a shared-password session).
 *   PUT /api/team-settings (POST is taken too), admins only:
 *       body {settings:{...}}  merges the keys sent into the saved settings (a partial update). Team keys only: other
 *                              keys are ignored. A key sent as null goes back to its default. Any value that fails its
 *                              check refuses the whole save (400 naming the key).
 *       body {reset:true}      every team setting back to its default (settings null).
 *       -> the GET answer plus saved:true and changed:[keys] (empty when nothing changed: then nothing is written).
 * Checks: atRiskTarget a whole number 1-50; toleranceDays 0-14; horizon 'w2', 'm1', 'w6' or 'm2'; otdGoalSales and
 * otdGoalVendors 50-100; noteCommentsSo and noteCommentsPo lists of texts: each trimmed with its spaces collapsed,
 * blanks and repeats (any capitalisation; the first spelling stays) left out, then each 1-120 characters, at most 30.
 * KV value: {v:1, settings, savedAt, savedBy, savedByEmail, history:[{at, by, byEmail, keys}]}; the addresses are not
 * sent to the page.
 * Errors {error:{code, message}}: 400, 401 (not signed in), 403 (not an admin, team settings off, or a write from
 * another site), 405, 429 with Retry-After (Workers KV busy), 500 (the saved settings could not be read; nothing is
 * written), 503 (no REPORT_STORE). Never cached (cache-control: no-store).
 * Workers KV has no locking: two admins saving within about a minute from different places can drop one change; the
 * history shows what went in.
 */
import { accessPerson, signedIn, teamSettingsOn, isAdmin } from '../../shared/admins.mjs';

const KEY = 'team-settings';
const MAX_BODY = 32 * 1024; // one PUT: two full comment lists are about 8 KB
const HISTORY_MAX = 20;
const COMMENT_MAX = 120;
const COMMENTS_MAX = 30;
const PUT_RETRY_MS = 1100; // Workers KV: one write per second to the same key
const ADMINS_ONLY = 'Only admins can change team settings.';

const whole = (lo, hi) => (v, key) => (Number.isInteger(v) && v >= lo && v <= hi ? { value: v } : { error: `${key} must be a whole number from ${lo} to ${hi}.` });
const oneOf = (list) => (v, key) => (list.includes(v) ? { value: v } : { error: `${key} must be one of ${list.join(', ')}.` });
export const TEAM_CHECKS = {
  atRiskTarget: whole(1, 50),
  toleranceDays: whole(0, 14),
  horizon: oneOf(['w2', 'm1', 'w6', 'm2']),
  otdGoalSales: whole(50, 100),
  otdGoalVendors: whole(50, 100),
  noteCommentsSo: commentList,
  noteCommentsPo: commentList,
};
const TEAM_KEYS = Object.keys(TEAM_CHECKS);

export async function onRequest(context) {
  const { request, env } = context;
  const write = request.method === 'PUT' || request.method === 'POST';
  if (request.method !== 'GET' && !write) return error(405, 'Use GET or PUT.', {}, { Allow: 'GET, PUT, POST' });
  const enabled = teamSettingsOn(context);
  const store = env && env.REPORT_STORE;

  if (!write) {
    if (!enabled) return json(200, { v: 1, enabled: false, settings: null, canEdit: false });
    if (!signedIn(context)) return error(401, 'Sign in to see the team settings.');
    const canEdit = isAdmin(context);
    if (!store) return error(503, 'Team settings storage is not set up on this site (REPORT_STORE).', { enabled: true, settings: null, canEdit });
    let doc;
    try { doc = await readDoc(store); } catch (err) {
      return error(500, 'The team settings could not be read; try again later.', { enabled: true, settings: null, canEdit });
    }
    return json(200, view(doc, canEdit));
  }

  // The session cookie is SameSite=Lax, and only the dashboard page itself may change the settings.
  if (request.headers.get('Origin') !== new URL(request.url).origin) return error(403, 'Cross-site request refused.');
  if (!signedIn(context)) return error(401, 'Sign in to change the team settings.');
  if (!isAdmin(context)) return error(403, ADMINS_ONLY, { enabled, canEdit: false });
  if (!store) return error(503, 'Team settings storage is not set up on this site (REPORT_STORE).', { saved: false });

  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return tooLarge();
  const text = await request.text();
  if (text.length > MAX_BODY) return tooLarge();
  let body;
  try { body = JSON.parse(text); } catch (err) { return error(400, 'The team settings are not valid JSON.', { saved: false }); }
  const change = readChange(body);
  if (change.error) return error(400, change.error, { saved: false });

  // A failed read must never be taken for "nothing saved": the merged settings would replace the team's.
  let doc;
  try { doc = await readDoc(store); } catch (err) {
    return error(500, 'The team settings could not be read; nothing was saved, try again.', { saved: false });
  }
  const next = { ...(doc.settings || {}) };
  let changed = [];
  if (change.reset) {
    if (doc.settings) { changed = ['reset']; }
  } else {
    for (const [k, v] of change.entries) {
      const had = Object.prototype.hasOwnProperty.call(next, k);
      if (v === null) { if (had) { delete next[k]; changed.push(k); } continue; }
      if (!had || JSON.stringify(next[k]) !== JSON.stringify(v)) { next[k] = v; changed.push(k); }
    }
  }
  if (changed.length) {
    const person = accessPerson(context);
    const by = person.name || person.email;
    const at = new Date().toISOString();
    doc.settings = change.reset ? null : ordered(next);
    doc.savedAt = at;
    doc.savedBy = by;
    doc.savedByEmail = person.email;
    doc.history = [{ at, by, byEmail: person.email, keys: changed }, ...doc.history].slice(0, HISTORY_MAX);
    const stored = JSON.stringify({ v: 1, settings: doc.settings, savedAt: at, savedBy: by, savedByEmail: person.email, history: doc.history });
    try { await store.put(KEY, stored); } catch (err) {
      // Workers KV takes one write per second to the same key; another save may have just gone in. Try once more.
      await new Promise((r) => setTimeout(r, PUT_RETRY_MS));
      try { await store.put(KEY, stored); } catch (err2) {
        return error(429, 'Busy saving, try again.', { saved: false }, { 'Retry-After': '2' });
      }
    }
  }
  return json(200, { ...view(doc, true), saved: true, changed });
}

// {reset:true} or {entries:[[key, value|null], ...]} (team keys only, each checked), else {error}.
function readChange(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send {settings:{...}} or {reset:true}.' };
  const hasSettings = body.settings !== undefined;
  if (body.reset === true) {
    if (hasSettings) return { error: 'Send either {settings:{...}} or {reset:true}, not both.' };
    return { reset: true };
  }
  if (body.reset !== undefined && body.reset !== false) return { error: 'reset must be true.' };
  const s = body.settings;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: 'Send {settings:{...}} or {reset:true}.' };
  const entries = [];
  for (const k of TEAM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
    if (s[k] === null) { entries.push([k, null]); continue; }
    const checked = TEAM_CHECKS[k](s[k], k);
    if (checked.error) return checked;
    entries.push([k, checked.value]);
  }
  return { entries };
}

// A comment list as the page keeps it: texts trimmed, spaces collapsed, blanks and repeats (any capitalisation) left out.
function commentList(v, key) {
  if (!Array.isArray(v) || v.length > COMMENTS_MAX * 4) return { error: `${key} must be a list of at most ${COMMENTS_MAX} comments.` };
  const seen = new Set();
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string') return { error: `${key} must be a list of texts.` };
    const s = x.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (s.length > COMMENT_MAX) return { error: `${key}: each comment must be at most ${COMMENT_MAX} characters.` };
    const low = s.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(s);
  }
  if (out.length > COMMENTS_MAX) return { error: `${key} must be a list of at most ${COMMENTS_MAX} comments.` };
  return { value: out };
}

// The saved document, every value checked again (one edited by hand that fails a check is left out). Nothing saved
// yet gives an empty one. A failed read, or a value that is not a settings document, throws.
async function readDoc(store) {
  const saved = await store.get(KEY, { type: 'json' });
  const doc = { settings: null, savedAt: '', savedBy: '', savedByEmail: '', history: [] };
  if (saved === null) return doc;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('The stored value is not a team settings document.');
  if (saved.settings && typeof saved.settings === 'object' && !Array.isArray(saved.settings)) {
    const settings = {};
    for (const k of TEAM_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(saved.settings, k)) continue;
      const checked = TEAM_CHECKS[k](saved.settings[k], k);
      if (!checked.error) settings[k] = checked.value;
    }
    doc.settings = Object.keys(settings).length ? settings : null;
  }
  for (const f of ['savedAt', 'savedBy', 'savedByEmail']) doc[f] = typeof saved[f] === 'string' ? saved[f] : '';
  if (Array.isArray(saved.history)) {
    doc.history = saved.history
      .filter((h) => h && typeof h === 'object' && typeof h.at === 'string' && Array.isArray(h.keys))
      .map((h) => ({
        at: h.at,
        by: typeof h.by === 'string' ? h.by : '',
        ...(typeof h.byEmail === 'string' ? { byEmail: h.byEmail } : {}),
        keys: h.keys.filter((k) => typeof k === 'string').slice(0, TEAM_KEYS.length + 1),
      }))
      .slice(0, HISTORY_MAX);
  }
  return doc;
}

// What the page gets: no addresses.
function view(doc, canEdit) {
  return {
    v: 1,
    enabled: true,
    settings: doc.settings,
    savedAt: doc.savedAt,
    savedBy: doc.savedBy,
    canEdit,
    history: doc.history.map((h) => ({ at: h.at, by: h.by, keys: h.keys.slice() })),
  };
}

// The team keys in a fixed order; null when none is set (every one at its default).
function ordered(settings) {
  const out = {};
  for (const k of TEAM_KEYS) if (Object.prototype.hasOwnProperty.call(settings, k)) out[k] = settings[k];
  return Object.keys(out).length ? out : null;
}

function tooLarge() {
  return error(400, `Too large: team settings are at most ${MAX_BODY / 1024} KB.`, { saved: false });
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
