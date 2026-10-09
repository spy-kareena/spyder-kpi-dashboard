/**
 * At-risk history: which order lines were on the At Risk card in each uploaded report, so the dashboard can say how
 * long a line has been at risk ("first flagged"). Written by PUT /api/report (functions/api/report.js) when a new
 * report is saved; stored in Workers KV (binding REPORT_STORE, key 'history'). The password gate in
 * functions/_middleware.js runs first.
 *   GET /api/history -> {v:1, weeks:[{asOf:'YYYY-MM-DD', savedAt, keys:[rowKey, ...]}]}, oldest first, one per week
 *                       (asOf is the earliest export date loaded that week), up to 52.
 */
const KEY = 'history';

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.REPORT_STORE;
  if (request.method !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
  if (!store) return json(503, { configured: false, error: 'Shared storage is not set up on this site (REPORT_STORE).' });
  let saved = null;
  try { saved = await store.get(KEY, { type: 'json' }); } catch (err) { saved = null; }
  const weeks = saved && Array.isArray(saved.weeks) ? saved.weeks.filter((w) => w && typeof w.asOf === 'string' && Array.isArray(w.keys)) : [];
  return json(200, { v: 1, weeks });
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
