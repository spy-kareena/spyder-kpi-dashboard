/**
 * At-risk history: which order lines were on the At Risk card in each uploaded report, so the dashboard can say how
 * long a line has been at risk ("first flagged"). Written by PUT /api/report (functions/api/report.js) when a new
 * report is saved; stored in Workers KV (binding REPORT_STORE). The password gate in functions/_middleware.js runs
 * first.
 *   GET /api/history -> {v:1, weeks:[{asOf:'YYYY-MM-DD', savedAt, keys:[rowKey, ...]}]}, oldest first, one per week
 *                       (asOf is the earliest export date loaded that week), up to 52. Each line key is listed only
 *                       under the first week it was at risk, which is all the page needs ("first flagged" is the
 *                       first week a key appears). A week saved with the At Risk card's figures also has
 *                       counts:{asOf, lines, orders, by?:{wh, seg, cust}} (by only on the newest 8 weeks), which the
 *                       page's weekly sparkline draws; older weeks have none.
 *   POST /api/history -> body {atRisk:{asOf:'YYYY-MM-DD', keys:[rowKey, ...], counts?}}: adds one week's at-risk lines without a
 *                       report upload. Live SAP data (2v6.8) is never uploaded, so the page sends its At Risk lines
 *                       here once a day; same rules as an upload (one entry per week, 52 weeks). Returns {weeks}.
 * KV keys: 'history' holds every at-risk line of each week (what report.js merges new uploads into); 'history:first'
 * is the compact copy report.js writes next to it (each key only under its first week) and is what GET serves, as
 * stored and without parsing it, so a page open costs almost no CPU. Until the first upload with this version only
 * 'history' exists, and it is served instead (the page gets the same "first flagged" answer from it).
 */
import { readAtRisk, addHistoryWeek, HISTORY_KEY as KEY, HISTORY_FIRST_KEY as FIRST_KEY } from '../../shared/history.mjs';

const MAX_BODY = 2 * 1024 * 1024; // 5,000 keys of up to 300 characters
const EMPTY = '{"v":1,"weeks":[]}';

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.REPORT_STORE;
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'Use GET or POST.' }, { Allow: 'GET, POST' });
  if (!store) return json(503, { configured: false, error: 'Shared storage is not set up on this site (REPORT_STORE).' });
  if (request.method === 'POST') {
    // The session cookie is SameSite=Lax, and only the dashboard page itself may add to the history.
    if (request.headers.get('Origin') !== new URL(request.url).origin) return json(403, { error: 'Cross-site request refused.' });
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json(413, { error: 'Too large.' });
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'Too large.' });
    let body = null;
    try { body = JSON.parse(text); } catch (err) { body = null; }
    const atRisk = readAtRisk(body && body.atRisk);
    if (!atRisk || atRisk.error) return json(400, { error: (atRisk && atRisk.error) || 'Send {atRisk:{asOf, keys}}.' });
    try {
      return json(200, { weeks: await addHistoryWeek(store, atRisk, new Date().toISOString()) });
    } catch (err) {
      return json(503, { error: 'The at-risk history could not be updated.' });
    }
  }
  let text = null;
  try {
    text = await store.get(FIRST_KEY);
    if (text === null) text = await store.get(KEY);
  } catch (err) { text = null; }
  // report.js writes both values as JSON.stringify({v:1, weeks}); anything else (nothing saved yet, a failed read, a
  // value edited by hand) is the empty history. The page checks each week it gets (cleanAtRiskWeeks in index.html).
  return raw(typeof text === 'string' && text.startsWith('{"v":1,"weeks":[') && text.endsWith(']}') ? text : EMPTY);
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
