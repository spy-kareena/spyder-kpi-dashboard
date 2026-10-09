/**
 * Shared report storage: the files of the last loaded report, kept for everyone who signs in, until a new
 * upload replaces them. Needs a Workers KV namespace bound to this Pages project as REPORT_STORE (see
 * docs/IT_HOSTING_README.md). The password gate in functions/_middleware.js runs first.
 *   GET /api/report -> 200 report bundle (application/octet-stream), 204 when nothing is saved yet
 *   PUT /api/report -> saves a bundle and returns {savedAt, files, history}
 * Bundle: 4-byte big-endian header length, a UTF-8 JSON header {v:1, savedAt, files:[{name, type,
 * lastModified, length}], atRisk?}, then each file's gzip bytes in header order. The server never reads the files.
 * Optional atRisk {asOf:'YYYY-MM-DD', keys:[rowKey, ...]} lists the lines on the report's At Risk card. It is not
 * stored with the report; it is added to the at-risk history (KV key 'history', read by GET /api/history in
 * functions/api/history.js): one entry per week (Monday to Sunday), a second upload in the same week is merged
 * into it, 52 weeks kept. A bad atRisk, or a history that cannot be read, never stops the report from saving
 * ({history:{error}} says why it was left out; the stored history is then left as it was).
 */
const KEY = 'report';
const HISTORY_KEY = 'history';
// One Workers KV value holds at most 25 MiB; the gzip copy of a year of SO/PO lines is about 1.3 MB.
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 12;
// The header carries the at-risk line keys (at most 5,000 of up to 300 characters).
const MAX_HEADER = 2 * 1024 * 1024;
const NAME_RE = /^[^\\/\u0000-\u001f]{1,200}\.(xlsx|xls|csv|txt|tsv)$/i;
const MAX_AT_RISK_KEYS = 5000;
const AT_RISK_KEY_RE = /^[^\u0000-\u001f\u007f]{1,300}$/;
const HISTORY_WEEKS = 52;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.REPORT_STORE;
  if (request.method !== 'GET' && request.method !== 'PUT') return json(405, { error: 'Use GET or PUT.' }, { Allow: 'GET, PUT' });
  if (!store) return json(503, { configured: false, error: 'Shared report storage is not set up on this site (REPORT_STORE).' });

  if (request.method === 'GET') {
    const saved = await store.get(KEY, { type: 'arrayBuffer' });
    if (!saved) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    return new Response(saved, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="report.bin"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  // The session cookie is SameSite=Lax, and only the dashboard page itself may replace the report.
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json(403, { error: 'Cross-site request refused.' });
  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES) return tooLarge();
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BYTES) return tooLarge();

  const parsed = readBundle(body);
  if (parsed.error) return json(400, { error: parsed.error });
  const savedAt = new Date().toISOString();
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, savedAt, files: parsed.files }));
  const out = new Uint8Array(4 + header.length + parsed.data.length);
  new DataView(out.buffer).setUint32(0, header.length);
  out.set(header, 4);
  out.set(parsed.data, 4 + header.length);
  await store.put(KEY, out);
  const saved = { savedAt, files: parsed.files.map((f) => f.name) };
  if (parsed.atRisk === undefined) return json(200, saved);
  if (parsed.atRisk.error) return json(200, { ...saved, history: { error: parsed.atRisk.error } });
  try {
    return json(200, { ...saved, history: { weeks: await addHistoryWeek(store, parsed.atRisk, savedAt) } });
  } catch (err) {
    return json(200, { ...saved, history: { error: 'The at-risk history could not be updated.' } });
  }
}

// The at-risk lines of one report: {asOf, keys} with unique keys, or {error}. Left out (undefined) when not sent.
function readAtRisk(raw) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') return { error: 'atRisk must be {asOf, keys}.' };
  const asOf = String(raw.asOf || '');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? Date.parse(`${asOf}T00:00:00Z`) : NaN;
  // A real calendar day from 2000 up to two days ahead (export dates are capped at the day of the upload).
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== asOf || day < Date.UTC(2000, 0, 1) || day > Date.now() + 2 * 864e5) {
    return { error: 'atRisk.asOf must be a date (YYYY-MM-DD).' };
  }
  if (!Array.isArray(raw.keys) || raw.keys.length > MAX_AT_RISK_KEYS) return { error: `atRisk.keys must be a list of at most ${MAX_AT_RISK_KEYS} line keys.` };
  if (!raw.keys.every((k) => typeof k === 'string' && AT_RISK_KEY_RE.test(k))) return { error: 'atRisk.keys holds a bad line key.' };
  return { asOf, keys: [...new Set(raw.keys)] };
}

// The Monday (UTC) of the week a YYYY-MM-DD date falls in.
function weekOf(asOf) {
  const d = new Date(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return asOf; // not a date: its own entry
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Files this upload's at-risk lines under its week (Monday to Sunday): one entry per week, so 52 entries are a
// year however often reports are loaded. A second upload in the same week is merged into that week's entry: the
// earlier export date, the newer savedAt, and every line on either list (a line at risk on Monday keeps Monday as
// its first-flagged date). Keeps the newest 52 weeks; returns how many are kept. A failed KV read throws, so the
// caller leaves the stored history as it is rather than replacing it with this one week; a stored value that is
// not JSON (it could never be read) is replaced.
async function addHistoryWeek(store, { asOf, keys }, savedAt) {
  const raw = await store.get(HISTORY_KEY, { type: 'text' });
  let saved = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch (err) { saved = null; }
  const byWeek = new Map();
  const list = (saved && Array.isArray(saved.weeks) ? saved.weeks : [])
    .filter((w) => w && typeof w.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.asOf) && Array.isArray(w.keys));
  for (const w of [...list, { asOf, savedAt, keys }]) {
    const id = weekOf(w.asOf);
    const had = byWeek.get(id);
    byWeek.set(id, !had ? { asOf: w.asOf, savedAt: String(w.savedAt || ''), keys: w.keys } : {
      asOf: had.asOf < w.asOf ? had.asOf : w.asOf,
      savedAt: had.savedAt > String(w.savedAt || '') ? had.savedAt : String(w.savedAt || ''),
      keys: [...new Set([...had.keys, ...w.keys])],
    });
  }
  const weeks = [...byWeek.values()];
  weeks.sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
  while (weeks.length > HISTORY_WEEKS) weeks.shift();
  // UTF-8 needs at most 3 bytes per UTF-16 unit, so a short history is measured without encoding it.
  const tooBig = (text) => text.length * 3 > MAX_HISTORY_BYTES && new TextEncoder().encode(text).length > MAX_HISTORY_BYTES;
  let text = JSON.stringify({ v: 1, weeks });
  while (weeks.length > 1 && tooBig(text)) { weeks.shift(); text = JSON.stringify({ v: 1, weeks }); }
  await store.put(HISTORY_KEY, text);
  return weeks.length;
}

// Checks the header against the bytes that follow it; returns clean file entries and the file bytes.
function readBundle(body) {
  if (body.length < 4) return { error: 'Empty report.' };
  const size = new DataView(body.buffer, body.byteOffset).getUint32(0);
  if (size < 2 || size > MAX_HEADER || 4 + size > body.length) return { error: 'Bad report header.' };
  let header;
  try { header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(4, 4 + size))); } catch (err) { return { error: 'Bad report header.' }; }
  const list = header && Array.isArray(header.files) ? header.files : null;
  if (!list || !list.length || list.length > MAX_FILES) return { error: `A report holds 1 to ${MAX_FILES} files.` };
  const files = [];
  let total = 0;
  for (const f of list) {
    const name = String(f && f.name || '');
    const length = Number(f && f.length);
    if (!NAME_RE.test(name)) return { error: 'Only .xlsx, .xls, .csv, .txt or .tsv files can be saved.' };
    if (!Number.isSafeInteger(length) || length < 0) return { error: 'Bad file length.' };
    total += length;
    files.push({ name, type: String(f.type || '').slice(0, 100), lastModified: Number(f.lastModified) || 0, length });
  }
  if (4 + size + total !== body.length) return { error: 'File lengths do not match the report.' };
  return { files, data: body.subarray(4 + size), atRisk: readAtRisk(header.atRisk) };
}

function tooLarge() {
  return json(413, { error: 'The report is larger than 24 MB after compression.' });
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
