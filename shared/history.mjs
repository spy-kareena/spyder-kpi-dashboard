// At-risk history in Workers KV (REPORT_STORE), shared by PUT /api/report (functions/api/report.js, each upload) and
// POST /api/history (functions/api/history.js, live SAP data once a day). KV key 'history' holds every at-risk line of
// each week; 'history:first' is the compact copy GET /api/history serves (each line only under its first week).
export const HISTORY_KEY = 'history';
export const HISTORY_FIRST_KEY = 'history:first';
export const MAX_AT_RISK_KEYS = 5000;
const AT_RISK_KEY_RE = /^[^\u0000-\u001f\u007f]{1,300}$/;
const HISTORY_WEEKS = 52;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

// The at-risk lines of one report: {asOf, keys} with unique keys, or {error}. Left out (undefined) when not sent.
export function readAtRisk(raw) {
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
  const counts = readCounts(raw.counts, asOf);
  return counts ? { asOf, keys: [...new Set(raw.keys)], counts } : { asOf, keys: [...new Set(raw.keys)] };
}

// The At Risk card's own figures that report, all filters off (the page's reportAtRiskWeek): {lines, orders} and, for
// the page's warehouse / segment / customer filters, by:{wh, seg, cust} with {name: [lines, orders]} each. The page's
// weekly sparkline draws them. Optional, and anything malformed is left out (the week's lines are still saved), so an
// older page, or a week saved before counts existed, simply has no point on the line.
const MAX_COUNT_NAMES = 2000;
const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= 1e7;
function readCounts(raw, asOf) {
  if (!raw || typeof raw !== 'object' || !isCount(raw.lines) || !isCount(raw.orders)) return undefined;
  const out = { asOf, lines: raw.lines, orders: raw.orders };
  if (raw.by && typeof raw.by === 'object') {
    const by = {};
    for (const dim of ['wh', 'seg', 'cust']) {
      const m = raw.by[dim];
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
      const names = Object.keys(m);
      if (names.length > MAX_COUNT_NAMES) continue;
      if (!names.every((k) => AT_RISK_KEY_RE.test(k) && Array.isArray(m[k]) && m[k].length === 2 && isCount(m[k][0]) && isCount(m[k][1]))) continue;
      by[dim] = Object.fromEntries(names.map((k) => [k, [m[k][0], m[k][1]]]));
    }
    if (Object.keys(by).length) out.by = by;
  }
  return out;
}
// Of two figures saved the same week, the later export's (the newer upload on the same date).
const laterCounts = (a, b) => (!a ? b : !b ? a : b.asOf >= a.asOf ? b : a);
const COUNT_BY_WEEKS = 8; // the compact copy carries the by-filter figures of the newest 8 weeks (the page's line)

// The Monday (UTC) of the week a YYYY-MM-DD date falls in.
export function weekOf(asOf) {
  const d = new Date(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return asOf; // not a date: its own entry
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Files this upload's at-risk lines under its week (Monday to Sunday): one entry per week, so 52 entries are a
// year however often reports are loaded. A second upload in the same week is merged into that week's entry: the
// earlier export date, the newer savedAt, and every line on either list (a line at risk on Monday keeps Monday as
// its first-flagged date), and the At Risk figures (counts) of the later export date. Keeps the newest 52 weeks; returns how many are kept. A failed KV read throws, so the
// caller leaves the stored history as it is rather than replacing it with this one week; a stored value that is
// not JSON (it could never be read) is replaced.
export async function addHistoryWeek(store, { asOf, keys, counts }, savedAt) {
  const raw = await store.get(HISTORY_KEY, { type: 'text' });
  let saved = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch (err) { saved = null; }
  const byWeek = new Map();
  const list = (saved && Array.isArray(saved.weeks) ? saved.weeks : [])
    .filter((w) => w && typeof w.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.asOf) && Array.isArray(w.keys));
  for (const w of [...list, { asOf, savedAt, keys, counts }]) {
    const id = weekOf(w.asOf);
    const had = byWeek.get(id);
    const c = w.counts && typeof w.counts === 'object' ? readCounts(w.counts, String(w.counts.asOf || w.asOf)) : undefined;
    const next = !had ? { asOf: w.asOf, savedAt: String(w.savedAt || ''), keys: w.keys } : {
      asOf: had.asOf < w.asOf ? had.asOf : w.asOf,
      savedAt: had.savedAt > String(w.savedAt || '') ? had.savedAt : String(w.savedAt || ''),
      keys: [...new Set([...had.keys, ...w.keys])],
    };
    const keep = laterCounts(had && had.counts, c);
    if (keep) next.counts = keep;
    byWeek.set(id, next);
  }
  const weeks = [...byWeek.values()];
  weeks.sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
  while (weeks.length > HISTORY_WEEKS) weeks.shift();
  // UTF-8 needs at most 3 bytes per UTF-16 unit, so a short history is measured without encoding it.
  const tooBig = (text) => text.length * 3 > MAX_HISTORY_BYTES && new TextEncoder().encode(text).length > MAX_HISTORY_BYTES;
  let text = JSON.stringify({ v: 1, weeks });
  while (weeks.length > 1 && tooBig(text)) { weeks.shift(); text = JSON.stringify({ v: 1, weeks }); }
  await store.put(HISTORY_KEY, text);
  // The compact copy GET /api/history serves on every page open: each line only under the first kept week it was
  // at risk (the page's "first flagged"), so a line at risk all year is sent once instead of 52 times. Built from the
  // kept weeks, so it gives the same answer as the full history, also after the oldest week drops off. If it cannot
  // be written it is removed, and GET serves the full history instead of an older compact copy.
  const seen = new Set();
  const firstSeen = (k) => { if (seen.has(k)) return false; seen.add(k); return true; };
  // Each week's At Risk figures go along (the page's sparkline); the by-filter ones only for the newest weeks it draws.
  const first = weeks.map((w, i) => {
    const out = { asOf: w.asOf, savedAt: w.savedAt, keys: w.keys.filter(firstSeen) };
    if (w.counts) {
      const { by, ...rest } = w.counts;
      out.counts = by && i >= weeks.length - COUNT_BY_WEEKS ? w.counts : rest;
    }
    return out;
  });
  try { await store.put(HISTORY_FIRST_KEY, JSON.stringify({ v: 1, weeks: first })); } catch (err) {
    try { await store.delete(HISTORY_FIRST_KEY); } catch (err2) { /* the older copy is served until the next upload */ }
  }
  return weeks.length;
}
