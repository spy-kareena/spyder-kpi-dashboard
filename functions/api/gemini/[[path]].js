/**
 * Server-key proxy for the dashboard's Ask AI panel. Set the key as a Pages secret (never in this repo):
 *   wrangler pages secret put GEMINI_API_KEY
 * The password gate in functions/_middleware.js runs first, so only signed-in users reach these routes:
 *   GET  /api/gemini/status                          -> {configured: true|false}
 *   GET  /api/gemini/models                          -> Google's model list
 *   POST /api/gemini/models/{model}:generateContent  -> Google's generateContent
 */
const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_RE = /^[a-z0-9][a-z0-9.-]{0,62}$/;
const MAX_BODY_BYTES = 1024 * 1024;

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/^\/api\/gemini\/?/, '');
  const generate = path.match(/^models\/([^/:]*):generateContent$/);
  const method = path === 'status' || path === 'models' ? 'GET' : generate ? 'POST' : null;
  if (!method) return json(404, { error: { code: 404, message: 'Not found' } });
  if (request.method !== method) return json(405, { error: { code: 405, message: `Use ${method}` } }, { Allow: method });

  const key = String(env.GEMINI_API_KEY || '');
  if (path === 'status') return json(200, { configured: Boolean(key) });
  if (!key) return json(503, { configured: false, error: { code: 503, message: 'GEMINI_API_KEY is not set on this site.' } });

  if (path === 'models') return forward(`${GOOGLE_BASE}/models?pageSize=100`, { method: 'GET', headers: { 'x-goog-api-key': key } });

  const model = generate[1];
  if (!MODEL_RE.test(model)) return json(400, { error: { code: 400, message: 'Invalid model name.' } });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return tooLarge();
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return tooLarge();
  return forward(`${GOOGLE_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body,
  });
}

// Google's status and JSON pass through unchanged, so the page shows the same errors as in own-key mode.
async function forward(url, init) {
  let upstream;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    return json(502, { error: { code: 502, message: 'Could not reach the Gemini API.' } });
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function tooLarge() {
  return json(413, { error: { code: 413, message: 'Request body is larger than 1 MB.' } });
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
