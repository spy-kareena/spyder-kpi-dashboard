/**
 * Shared report storage: the files of the last loaded report, kept for everyone who signs in, until a new
 * upload replaces them. Needs a Workers KV namespace bound to this Pages project as REPORT_STORE (see
 * docs/IT_HOSTING_README.md). The password gate in functions/_middleware.js runs first.
 *   GET /api/report -> 200 report bundle (application/octet-stream), 204 when nothing is saved yet
 *   PUT /api/report -> saves a bundle and returns {savedAt, files}
 * Bundle: 4-byte big-endian header length, a UTF-8 JSON header {v:1, savedAt, files:[{name, type,
 * lastModified, length}]}, then each file's gzip bytes in header order. The server never reads the files.
 */
const KEY = 'report';
// One Workers KV value holds at most 25 MiB; the gzip copy of a year of SO/PO lines is about 1.3 MB.
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 12;
const MAX_HEADER = 64 * 1024;
const NAME_RE = /^[^\\/\u0000-\u001f]{1,200}\.(xlsx|xls|csv|txt|tsv)$/i;

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
  return json(200, { savedAt, files: parsed.files.map((f) => f.name) });
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
  return { files, data: body.subarray(4 + size) };
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
